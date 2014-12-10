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

  getStates: function () {
    var states = {};

    try {
      states = JSON.parse(fs.readFileSync('./states-bbva-bancomer.json', 'utf8'));
    } catch (e) {}

    return Q.when(states);
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

  getCities: function (stateId, municipalityId) {
    var defer = Q.defer();

    if(!stateId) {
      throw new Error('The stateId parameter is required.');
    }

    if(!municipalityId) {
      throw new Error('The municipalityId parameter is required.');
    }

    this.doRequest(this.citiesUrl, { idEstado: stateId, idMunicipio: municipalityId[0] })
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
    var options = this.getConsoleOptions();

    AtmHelper.bank = BbvaBancomer;

    // {
    //   idEstado: '14',
    //
    //   idMunicipio: '14039',
    //
    //   idCategoria: '1',
    //   idLocalidad: '140390001',
    //   idColonia: '0',
    //   criterio: ''
    // }

    if(options.list) {
      if(options.stateId) {
        if(options.municipalityId) {
          this.listCities(options.stateId, options.municipalityId);
        } else {
          this.listMunicipalities(options.stateId);
        }
      } else {
        this.listStates();
      }
    } else {

    }
  }
};

BbvaBancomer.main();
