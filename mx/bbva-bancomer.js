'use strict';

var _ = require('underscore'),
    fs = require('fs'),
    nomnom = require('nomnom'),
    Q = require('q'),
    request = require('request'),
    AtmHelper = require('./AtmHelper'),
    Helper = require('./Helper'),
    BbvaBancomer;

_.str = require('underscore.string');

BbvaBancomer = {
  name: 'BBVA Bancomer',
  features: {},
  hashes: {},
  coordinates: {},
  states: {},
  municipalities: {},
  refererUrl: 'http://184.106.19.51/',
  municipalitiesUrl: 'http://184.106.19.51/BuscadorSucursales/ServicioMapa.asmx/ObtenerMunicipios',
  citiesUrl: 'http://184.106.19.51/BuscadorSucursales/ServicioMapa.asmx/ObtenerLocalidades',
  branchesUrl: 'http://184.106.19.51/BuscadorSucursales/ServicioMapa.asmx/BusquedaGeografica',

  doRequest: function (url, data) {
    var defer = Q.defer(),
      options = {
        url: url,
        headers: {
          'Referer': BbvaBancomer.refererUrl
        },
        body: data,
        json: true
      };

    request.post(options, function (error, response, body) {
      defer.resolve(body);
    });

    return defer.promise;
  },

  // Discard other information separated by commas, also remove zip code, number label (no, num, numero),
  //  neighborhood and double spaces
  sanitizeAddress: function (address) {
    address = address.split(',')[0].toLowerCase();
    address = address.replace(/\s*c\.?p\.?\s*\d{1,5}\s*/gi, ' ');
    address = address.replace(/\s+(no|num|numero)(\.?\s+|\.)/gi, ' ').trim();
    address = address.replace(/\s+col\.?\s+\.*/gi, ' ').trim();

    return _.str.titleize(address.replace(/\s{2,}/, ' '));
  },

  sanitizeAtmId: function (atmId) {
    return parseInt(atmId.replace(/[a-z]+/gi, ''), 10);
  },

  toFeature: function (atm) {
    var state,
      name,
      municipality,
      atmId;

    atm.Campos = BbvaBancomer.getFieldHash(atm.Campos);
    state = _.str.titleize(atm.Campos.ESTADO.toLowerCase().replace(/_/g, ' '));
    name = _.str.titleize(AtmHelper.sanitizeNumberedName(atm.Nombre.trim()).toLowerCase());
    municipality = BbvaBancomer.municipalities[atm.Campos.ID_ESTADO][atm.Campos.ID_MUNICIPIO];

    return {
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: [atm.Longitud, atm.Latitud]
      },
      properties: {
        bank: BbvaBancomer.name,
        type: 'ATM',
        state: state,
        municipality: _.str.titleize(municipality.toLowerCase()),
        name: name,
        address: BbvaBancomer.sanitizeAddress(atm.Campos.DOMICILIO),
        neighborhood: _.str.titleize(atm.Campos.COL.toLowerCase()),
        zipCode: _.str.lpad(atm.Campos.CP, 5, '0'),
        phone: '',
        atmId: BbvaBancomer.sanitizeAtmId(atm.Campos.ATM),
        openingHours: {},
        isVerified: false
      }
    };
  },

  getFieldHash: function (fieldArray) {
    var hash = {};

    fieldArray.forEach(function (field) {
      hash[field.Etiqueta] = field.Valor;
    });

    return hash;
  },

  getByState: function (stateId) {
    var defer = Q.defer(),
        promises = [];

    this.getMunicipalityIds(stateId).then(function (municipalityIds) {
      municipalityIds.forEach(function (municipalityId) {
        promises.push(BbvaBancomer.getByMunicipality(stateId, municipalityId));
      });

      Q.all(promises).then(function () { defer.resolve(); });
    });

    return defer.promise;
  },

  getByMunicipality: function (stateId, municipalityId) {
    var defer = Q.defer(),
        promises = [];

    this.getMunicipalityName(stateId, municipalityId).then(function () {
      BbvaBancomer.getCityIds(stateId, municipalityId).then(function (cityIds) {
        cityIds.forEach(function (cityId) {
          promises.push(BbvaBancomer.getByCity(stateId, municipalityId, cityId));
        });

        Q.all(promises).then(function () { defer.resolve(); });
      });
    });

    return defer.promise;
  },

  getByCity: function (stateId, municipalityId, cityId) {
    var defer = Q.defer(),
        features = [],
        feature;

    this.doGetByCity(stateId, municipalityId, cityId).then(function (response) {
      response.d.forEach(function (item) {
        feature = BbvaBancomer.toFeature(item);
        features.push(feature);
        AtmHelper.addToState(Helper.toSpinalCase(feature.properties.state), 'atm', feature);
      });

      defer.resolve(features);
    });

    return defer.promise;
  },

  doGetByCity: function (stateId, municipalityId, cityId, defer) {
    var data = {
      idCategoria: '1',
      idEstado: stateId,
      idMunicipio: municipalityId,
      idLocalidad: cityId,
      idColonia: '0',
      criterio: ''
    };

    if(!defer) {
      defer = Q.defer();
    }

    console.log('Retrieving city: ' + cityId);

    BbvaBancomer.doRequest(BbvaBancomer.branchesUrl, data)
      .then(function (response) {
        defer.resolve(response);
      });

    return defer.promise;
  },

  getStates: function () {
    var states = {};

    try {
      states = JSON.parse(fs.readFileSync('./states-bbva-bancomer.json', 'utf8'));
    } catch (e) {}

    return Q.when(states);
  },

  getStateIds: function () {
    var defer = Q.defer();

    this.getStates().then(function (states) {
      defer.resolve(_.pluck(states, 'id'));
    });

    return defer.promise;
  },

  getMunicipalities: function (stateId) {
    var defer = Q.defer();

    if(!stateId) {
      throw new Error('The stateId parameter is required.');
    }

    this.doRequest(this.municipalitiesUrl, { idEstado: stateId })
      .then(function (response) {
        var municipalities;

        municipalities = response.d.map(function (municipality) {
          return {
            id: municipality.IdMunicipio,
            name: _.str.titleize(municipality.Municipio.toLowerCase())
          };
        });

        defer.resolve(municipalities);
      });

    return defer.promise;
  },

  getMunicipalityName: function (stateId, municipalityId) {
    var defer;
    try {
    if(!this.municipalities[stateId]) {
      defer = Q.defer();

      this.getMunicipalities(stateId).then(function (municipalities) {
        BbvaBancomer.municipalities[stateId] = {};

        municipalities.forEach(function (municipality) {
          BbvaBancomer.municipalities[stateId][municipality.id] = municipality.name;
        });

        defer.resolve(BbvaBancomer.municipalities[stateId][municipalityId]);
      });

      return defer.promise;
    }

    return Q.when(this.municipalities[stateId][municipalityId]);
    } catch(e) { console.log(e); }
  },

  getMunicipalityIds: function (stateId) {
    var defer = Q.defer();

    this.getMunicipalities(stateId).then(function (municipalities) {
      defer.resolve(_.pluck(municipalities, 'id'));
    });

    return defer.promise;
  },

  getCities: function (stateId, municipalityId) {
    var defer = Q.defer();

    if(!stateId) {
      throw new Error('The stateId parameter is required.');
    }

    if(!municipalityId) {
      throw new Error('The municipalityId parameter is required.');
    }

    this.doRequest(this.citiesUrl, { idEstado: stateId, idMunicipio: municipalityId })
      .then(function (response) {
        var cities;

        cities = response.d.map(function (city) {
          return {
            id: city.IdLocalidad,
            name: _.str.titleize(city.Localidad.toLowerCase())
          };
        });

        defer.resolve(cities);
      });

    return defer.promise;
  },

  getCityIds: function (stateId, municipalityId) {
    var defer = Q.defer();

    this.getCities(stateId, municipalityId).then(function (cities) {
      defer.resolve(_.pluck(cities, 'id'));
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

  listCities: function (stateId, municipalityId) {
    this.getCities(stateId, municipalityId).then(function (cities) {
      console.log(cities, stateId, municipalityId);
      cities.forEach(function (city) {
        console.log(city.id + ': ' + city.name);
      });
    });
  },

  getConsoleOptions: function () {
    var options = nomnom.script('node bbva-bancomer.js')
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
        cityId: {
          position: 2,
          abbr: 'c',
          help: 'City id (must belong to the specified municipality, can be a comma-separated ' +
            'list of values)',
          transform: function (cities) {
            return cities.toString().split(',');
          }
        },
        list: {
          abbr: 'l',
          flag: true,
          help: 'Will display the possible values for stateId if no options are passed, the possible ' +
            'values for municipalityId if stateId is provided, or the possible values for cityId if ' +
            'stateId and municipalityId are provided'
        }
      }).parse();

    return options;
  },

  main: function () {
    var promise,
        promiseArray = [],
        options = this.getConsoleOptions();

    AtmHelper.bank = BbvaBancomer;

    try {
      if(options.list) {
        if(options.stateId) {
          if(options.municipalityId) {
            this.listCities(options.stateId, options.municipalityId[0]);
          } else {
            this.listMunicipalities(options.stateId);
          }
        } else {
          this.listStates();
        }
      } else {
        if(options.stateId) {
          if(options.municipalityId) {
            _.each(options.municipalityId, function (municipalityId) {
              promiseArray.push(BbvaBancomer.getByMunicipality(options.stateId, municipalityId));
            });

            promise = Q.all(promiseArray);
          } else {
            promise = this.getByState(options.stateId);
          }
        } else {
          // Fetch all data!
        }

        promise.then(function () {
          AtmHelper.makeItRain(BbvaBancomer.features, Helper.toSpinalCase(BbvaBancomer.name));
        });
      }
    } catch (e) {
      console.log(e);
    }
  }
};

BbvaBancomer.main();
