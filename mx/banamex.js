'use strict';

var Q = require('q'),
    util = require('util'),
    request = require('request'),
    _ = require('underscore'),
    sleep = require('sleep'),
    nomnom = require('nomnom'),
    fs = require('fs'),
    Helper = require('./Helper'),
    AtmHelper = require('./AtmHelper'),
    Banamex;

_.str = require('underscore.string');

Banamex = {
  name: 'Banamex',
  features: {},
  hashes: {},
  coordinates: {},
  states: {},
  municipalitiesUrl: 'http://portal.banamex.com.mx/c719_050/mapasAction.do?opcion=llenaCombos&id_estado=%s',
  branchesUrl: 'http://portal.banamex.com.mx/c719_050/mapasAction.do?opcion=buscar&accion=cajero-porDom&' +
    'tipoBus=300&idioma=esp&estado=%s&iddel=%s',

  getUrl: function (stateId, municipalityId) {
    if(stateId) {
      if(municipalityId) {
        return util.format(this.branchesUrl, stateId, municipalityId);
      }

      return util.format(this.municipalitiesUrl, stateId);
    }
  },

  getByState: function (stateId) {
    var defer = Q.defer(),
        promises = [];

    this.getMunicipalityIds(stateId).then(function (municipalityIds) {
      municipalityIds.forEach(function (municipalityId) {
        promises.push(Banamex.getByMunicipality(stateId, municipalityId));
        sleep.sleep(5);
      });

      Q.all(promises).then(function () { defer.resolve(); });
    });

    return defer.promise;
  },

  getByMunicipality: function (stateId, municipalityId) {
    var defer = Q.defer(),
        features,
        feature;

    this.doGetByMunicipality(stateId, municipalityId).then(function (response) {
      features = response.split('^').forEach(function (featureStr) {
        feature = Banamex.toFeature(featureStr);

        AtmHelper.addToState(Helper.toSpinalCase(feature.properties.state), 'atm', feature);
      });

      defer.resolve();
    });

    return defer.promise;
  },

  doGetByMunicipality: function (stateId, municipalityId, defer) {
    var body;

    if(!defer) {
      defer = Q.defer();
    }

    console.log('Retrieving municipality: ' + municipalityId);

    request.get(this.getUrl(stateId, municipalityId),
      function (error, response, body) {
        body = body.trim();

        if(body && body !== 'No') {
          defer.resolve(body);
        } else {
          console.log('Failed:', stateId, municipalityId, error);
          Banamex.doGetByMunicipality(stateId, municipalityId, defer);
        }
      });

    return defer.promise;
  },

  // TODO(thewarpaint): Process this file: http://portal.banamex.com.mx/mapas/buscador/js/estados.js
  getStates: function () {
    var states = {};

    try {
      states = JSON.parse(fs.readFileSync('./states-banamex.json', 'utf8'));
    } catch (e) {}

    return Q.when(states);
  },

  getMunicipalities: function (stateId) {
    var defer = Q.defer();

    if(!stateId) {
      throw new Error('The stateId parameter is required.');
    }

    request.get(this.getUrl(stateId),
      function (error, response, body) {
        var sections,
            municipalities;

        sections = body.trim().split('=')[1].split('||');

        municipalities = sections.map(function (section) {
          var parts = section.split('|');
          return {
            id: parts[0],
            name: _.str.titleize(parts[1].toLowerCase())
          };
        });

        defer.resolve(municipalities);
      });

    return defer.promise;
  },

  getMunicipalityIds: function (stateId) {
    var defer = Q.defer();

    this.getMunicipalities(stateId).then(function (municipalities) {
      defer.resolve(_.pluck(municipalities, 'id'));
    });

    return defer.promise;
  },

  listStates: function () {
    this.getStates().then(function (states) {
      states.forEach(function (state) {
        console.log(state.id + ': ' + state.name);
      });
    });
  },

  listMunicipalities: function (stateId) {
    this.getMunicipalities(stateId).then(function (municipalities) {
      municipalities.forEach(function (municipality) {
        console.log(municipality.id + ': ' + municipality.name);
      });
    });
  },

  toFeature: function (atmString) {
    var fields = atmString.split('|'),
      name = AtmHelper.sanitizeNumberedName(fields[1].trim()).toLowerCase();

    return {
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: [fields[21], fields[22]]
      },
      properties: {
        bank: Banamex.name,
        type: 'ATM',
        state: _.str.titleize(fields[2].toLowerCase()),
        municipality: _.str.titleize(fields[4].toLowerCase()),
        name: _.str.titleize(name.trim()),
        address: _.str.titleize((fields[6] + ' ' + fields[7]).toLowerCase()),
        neighborhood: _.str.titleize(fields[8].toLowerCase()),
        zipCode: fields[9],
        phone: '',
        atmId: fields[0],
        openingHours: {},
        isVerified: false
      }
    };
  },

  getConsoleOptions: function () {
    var options = nomnom.script('node banamex.js')
      .options({
        stateId: {
          position: 0,
          abbr: 's',
          help: 'State id'
        },
        municipalityId: {
          position: 1,
          abbr: 'm',
          help: 'Municipality id (must belong to the specified state, can be a comma-separated ' +
            'list of values)',
          transform: function (municipalities) {
            return municipalities.toString().split(',');
          }
        },
        list: {
          abbr: 'l',
          flag: true,
          help: 'Will display the possible values for stateId if no options are passed, or the possible ' +
            'values for municipalityId if stateId is provided'
        }
      }).parse();

    return options;
  },

  main: function () {
    var promise,
        promiseArray = [],
        options = this.getConsoleOptions();

    AtmHelper.bank = Banamex;

    if(options.list) {
      if(options.stateId) {
        this.listMunicipalities(options.stateId);
      } else {
        this.listStates();
      }
    } else {
      if(options.stateId) {
        if(options.municipalityId) {
          _.each(options.municipalityId, function (municipalityId) {
            promiseArray.push(Banamex.getByMunicipality(options.stateId, municipalityId));
          });

          promise = Q.all(promiseArray);
        } else {
          promise = this.getByState(options.stateId);
        }
      }

      promise.then(function () {
        AtmHelper.makeItRain(Banamex.features, Helper.toSpinalCase(Banamex.name));
      });
    }
  }
};

Banamex.main();
