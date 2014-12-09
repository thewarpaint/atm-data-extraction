'use strict';

var Q = require('q'),
    fs = require('fs'),
    md5 = require('md5'),
    request = require('request'),
    _ = require('underscore'),
    nomnom = require('nomnom'),
    sleep = require('sleep'),
    util = require('util'),
    Helper = require('./Helper'),
    AtmHelper = require('./AtmHelper'),
    Santander;

_.str = require('underscore.string');

Santander = {
  name: 'Santander',
  optionRegex: /<option value="([\w\s\u00C0-\u017F]+)">[\w\s\u00C0-\u017F]+<\/option>/gi,
  mapDataRegex: /<script>\s*mapData\s*=\s*([\s\S]+);\s*<\/script>/gim,
  emptyPhoneRegex: /(\s*)\s*\/\s*/i,
  atmNumberedName: /(.*)\s+\d+$/,
  features: {},
  hashes: {},
  coordinates: {},
  baseUrl: 'https://servicios.santander.com.mx/sucursales2012/MapaAJAX.php?option1=true&option2=true&' +
    'option3=true&option4=true&estado=%s',

  // Get municipalities this way:
  getUrl: function (state, municipality, neighborhood) {
    var url = util.format(this.baseUrl, encodeURIComponent(state));

    if(municipality) {
      url += '&municipio=' + encodeURIComponent(municipality);
    }

    if(neighborhood) {
      url += '&colonia=' + encodeURIComponent(neighborhood) + '&actionmap=sucursales';
    }

    return url;
  },

  // TODO(thewarpaint): Fix endless cycle for string with only one match
  getMatches: function (string, regex, index) {
    var matches = [],
        match;

    index = index || 1; // default to the first capturing group

    while (match = regex.exec(string)) {
      matches.push(match[index]);
    }

    return matches;
  },

  getByState: function (state) {
    request.get(Santander.getUrl(state),
      function (error, response, body) {
        var municipalities = Santander.getMatches(body, Santander.optionRegex);

        for(var j=0; j<municipalities.length; j++) {
          Santander.getByMunicipality(state, municipalities[j]);
        }
      });
  },

  getByMunicipality: function (state, municipality) {
    var d = Q.defer(),
      promises = [];

    console.log('Retrieving municipality: ' + municipality);

    Santander.getNeighborhoods(state, municipality).then(function (neighborhoods) {
      neighborhoods.forEach(function (neighborhood) {
        promises.push(Santander.getByNeighborhood(state, municipality, neighborhood));
        sleep.sleep(1);
      });

      Q.all(promises).then(function () { d.resolve(); });
    });

    return d.promise;
  },

  getByNeighborhood: function (state, municipality, neighborhood) {
    var defer = Q.defer(),
        type,
        realType,
        feature;

    this.doGetByNeighborhood(state, municipality, neighborhood).then(function (atms) {
      for(var i=0; i<atms.markers.length; i++) {
        type = atms.markers[i].tipo.toLowerCase();
        realType = (type === 'cajero' ? 'atm' : 'other');
        feature = Santander.toFeature(state, municipality, atms.markers[i]);

        AtmHelper.addToState(Helper.toSpinalCase(state), realType, feature);
      }

      defer.resolve();
    });

    return defer.promise;
  },

  doGetByNeighborhood: function (state, municipality, neighborhood, defer) {
    var url = Santander.getUrl(state, municipality, neighborhood);

    if(!defer) {
      defer = Q.defer();
    }

    console.log('Retrieving neighborhood:', neighborhood);

    request.get(url, function (error, response, body) {
      var json,
          atms;

      try {
        json = Santander.getMatches(body, Santander.mapDataRegex);
        atms = JSON.parse(json);

        defer.resolve(atms);
      } catch (e) {
        console.log('Failed:', state, municipality, neighborhood, error);
        Santander.doGetByNeighborhood(state, municipality, neighborhood, defer);
      }
    });

    return defer.promise;
  },

  getMunicipalities: function (state) {
  },

  // Leaving this here in case any preprocessing is needed in the future
  getNeighborhoods: function (state, municipality) {
    return Santander.doGetNeighborhoods(state, municipality);
  },

  doGetNeighborhoods: function (state, municipality, defer) {
    var url = Santander.getUrl(state, municipality);

    if(!defer) {
      defer = Q.defer();
    }

    console.log('Retrieving neighborhoods for:', municipality);

    request.get(url, function (error, response, body) {
      var neighborhoods = Santander.getMatches(body, Santander.optionRegex);

      if(neighborhoods.length === 0) {
        console.log('Failed:', state, municipality, error);
        Santander.doGetNeighborhoods(state, municipality, defer);
      } else {
        defer.resolve(neighborhoods);
      }
    });

    return defer.promise;
  },

  /*
   * Forms:
   * 999 abcdef ghijkl
   * X999 123-abcdef ghijkl
   * X999 123/456 abcdef ghijkl
   */
  sanitizeName: function (name) {
    var parts = {
          'name': name,
          'branchId': null
        },
        branchIdRegex = /^(x?\d+\s?[\d\/]*[\-\s]?)/gi,
        branchId,
        nameParts;

    branchId = branchIdRegex.exec(parts.name);

    if(branchId !== null) {
      parts.branchId = branchId[0].replace('-', '');
      parts.name = parts.name.replace(branchId[0], '');
    }

    parts.name = _.str.titleize(parts.name.toLowerCase());

    if(Santander.atmNumberedName.test(parts.name)) {
      nameParts = Santander.atmNumberedName.exec(parts.name);

      if(nameParts.length !== 0) {
        parts.name = nameParts[1];
      }
    }

    return parts;
  },

  sanitizePhone: function (phone) {
    if(Santander.emptyPhoneRegex.test(phone)) {
      return null;
    }

    return phone;
  },

  sanitizeAtm: function (atmId) {
    var array = atmId.split(' '),
      parts = {
        branchId: '',
        atmId: atmId
      };

    if(array.length > 1) {
      parts.atmId = array[0];
      parts.branchId = array[1];
    }

    return parts;
  },

  doesPropertyMatch: function (oldFeature, feature, propertyName) {
    if(!oldFeature.properties[propertyName]) {
      throw new Error('Property ' + propertyName + ' does not exist on oldFeature parameter.');
    }

    if(!feature.properties[propertyName]) {
      throw new Error('Property ' + propertyName + ' does not exist on feature parameter.');
    }

    if(oldFeature.properties[propertyName] instanceof Array) {
      return oldFeature.properties[propertyName].indexOf(feature.properties[propertyName]) !== -1;
    }

    return oldFeature.properties[propertyName] === feature.properties[propertyName];
  },

  /**
   * Add a property from a feature to another one. If the property is not yet an array, convert it.
   *
   * TODO(thewarpaint): Move to global utility file
   */
  addProperty: function (oldFeature, feature, propertyName) {
    if(!oldFeature.properties[propertyName]) {
      throw new Error('Property ' + propertyName + ' does not exist on oldFeature parameter.');
    }

    if(!feature.properties[propertyName]) {
      throw new Error('Property ' + propertyName + ' does not exist on feature parameter.');
    }

    console.log('Type:', typeof oldFeature.properties[propertyName]);

    if(!Array.isArray(oldFeature.properties[propertyName])) {
      oldFeature.properties[propertyName] = [oldFeature.properties[propertyName]];
    }

    oldFeature.properties[propertyName].push(feature.properties[propertyName]);
    oldFeature.properties[propertyName].sort();

    return oldFeature;
  },

  toFeature: function (state, municipality, hash) {
    var nameParts = Santander.sanitizeName(hash.sucursal),
      atmParts = Santander.sanitizeAtm(nameParts.branchId.trim()),
      address = _.str.titleize(hash.calle.toLowerCase() + ' ' + hash.numero.toLowerCase()).trim(),
      name = nameParts.name.trim();

    municipality = _.str.titleize(municipality.toLowerCase());

    return {
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: [hash.longitud, hash.latitud]
      },
      properties: {
        bank: Santander.name,
        state: _.str.titleize(state.toLowerCase()),
        type: hash.tipo.toLowerCase(),
        municipality: municipality,
        name: name,
        address: address,
        neighborhood: _.str.titleize(hash.colonia.toLowerCase()),
        zipCode: hash.cp,
        phone: Santander.sanitizePhone(hash.telefono),
        branchId: atmParts.branchId,
        atmId: atmParts.atmId,
        openingHours: {},
        isVerified: false
      }
    };
  },

  addIssue: function (feature, issue) {
    if (!feature.properties.issues) {
      feature.properties.issues = [];
    }

    if (feature.properties.issues.indexOf(issue) === -1) {
      feature.properties.issues.push(issue);
    }
  },

  makeItRain: function () {
    _.each(Santander.features, function (types, state) {
      _.each(types, function (featureColl, type) {
        console.log('Writing data for ' + state + ': ' + type);
        featureColl.features = _.sortBy(featureColl.features, function (feature) {
          return feature.properties.branchId + feature.geometry.coordinates.join('');
        });
        fs.writeFile(state + '/santander-' + type + '.raw.geojson', JSON.stringify(featureColl, null, 2));
      });
    });
  },

  getConsoleOptions: function () {
    var options = nomnom.script('node santander.js')
      .options({
        state: {
          position: 0,
          required: true,
          abbr: 's',
          help: 'State'
        },
        municipality: {
          position: 1,
          abbr: 'm',
          help: 'Municipality (must belong to the specified state)',
          transform: function (municipalities) {
            return municipalities.split(',');
          }
        },
        neighborhood: {
          position: 2,
          abbr: 'n',
          help: 'Neighborhood (must belong to the specified state and municipality)'
        },
        list: {
          abbr: 'l',
          flag: true,
          help: 'Will display the possible values for state if no options are passed, the possible ' +
            'values for municipality if stateId is provided, or the possible values for neighborhood if ' +
            'state and municipality are provided'
        }
      }).parse();

    return options;
  },

  main: function () {
    var promise,
      promiseArray = [],
      options = Santander.getConsoleOptions();

  AtmHelper.bank = Santander;
    if(options.list) {
      if(options.stateId) {
        this.listMunicipalities(options.stateId);
      } else {
        this.listStates();
      }
    } else {
      if(options.state) {
        if(options.municipality) {
          if(options.neighborhood) {
            promise = Santander.getByNeighborhood(options.state, options.municipality, options.neighborhood);
          } else {
            _.each(options.municipality, function (municipality) {
              promiseArray.push(Santander.getByMunicipality(options.state, municipality));
            });

            promise = Q.all(promiseArray);
          }
        } else {
          promise = Santander.getByState(options.state);
        }
      }
    }

    promise.then(function () {
      Santander.makeItRain();
    });
  }
};

Santander.main();
