'use strict';

var Q = require('q'),
    fs = require('fs'),
    md5 = require('md5'),
    request = require('request'),
    _ = require('underscore'),
    nomnom = require('nomnom'),
    sleep = require('sleep'),
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
  states: [
    'AGUASCALIENTES',
    'BAJA CALIFORNIA',
    'BAJA CALIFORNIA SUR',
    'CAMPECHE',
    'CHIAPAS',
    'CHIHUAHUA',
    'COAHUILA',
    'COLIMA',
    'DISTRITO FEDERAL',
    'DURANGO',
    'ESTADO DE MEXICO',
    'GUANAJUATO',
    'GUERRERO',
    'HIDALGO',
    'JALISCO',
    'MICHOACAN',
    'MORELOS',
    'NAYARIT',
    'NUEVO LEON',
    'OAXACA',
    'PUEBLA',
    'QUERETARO',
    'QUINTANA ROO',
    'SAN LUIS POTOSI',
    'SINALOA',
    'SONORA',
    'TABASCO',
    'TAMAULIPAS',
    'TLAXCALA',
    'VERACRUZ',
    'YUCATAN',
    'ZACATECAS'
  ],

  // Get municipalities this way:
  getUrl: function (state, municipality, neighborhood) {
    var url = 'https://servicios.santander.com.mx/sucursales2012/MapaAJAX.php?option1=true&option2=true&' +
      'option3=true&option4=true&estado=' + encodeURIComponent(state);

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

    request.get(Santander.getUrl(state, municipality),
      function (error, response, body) {
        var neighborhoods = Santander.getMatches(body, Santander.optionRegex);

        for(var k=0; k<neighborhoods.length; k++) {
          promises.push(Santander.getByNeighborhood(state, municipality, neighborhoods[k]));
        }

        Q.all(promises).then(function () { d.resolve(); });
      });

    return d.promise;
  },

  getByNeighborhood: function (state, municipality, neighborhood) {
    var d = Q.defer(),
      url = Santander.getUrl(state, municipality, neighborhood);

    console.log('Retrieving neighborhood: ' + neighborhood);

    request.get(url, function (error, response, body) {
        var json,
            atms,
            type,
            realType,
            feature;

        json = Santander.getMatches(body, Santander.mapDataRegex);

        // TODO(thewarpaint): Handle network errors and retry logic.
        atms = JSON.parse(json);

        for(var i=0; i<atms.markers.length; i++) {
          type = atms.markers[i].tipo.toLowerCase();
          realType = (type === 'cajero' ? 'atm' : 'other');
          feature = Santander.toFeature(state, municipality, atms.markers[i]);

          Santander.addToState(Santander.spinalCase(state), realType, feature);
        }

        d.resolve();
      });

    sleep.sleep(1);

    return d.promise;
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

  initState: function (state) {
    Santander.features[state] = {};
    Santander.hashes[state] = {};
    Santander.coordinates[state] = {};
  },


  initType: function (state, type) {
    Santander.features[state][type] = {
      type: 'FeatureCollection',
      features: []
    };

    Santander.hashes[state][type] = [];
    Santander.coordinates[state][type] = {};
  },

  // TODO(thewarpaint): Move to global utility file
  spinalCase: function (string) {
    return string.toLowerCase().replace(/\s+/, '-');
  },

  addToState: function (state, type, feature) {
    var hash = md5(JSON.stringify(feature)),
      coordinatesKey = feature.geometry.coordinates.join(','),
      oldFeature;

    if(!Santander.features[state]) {
      Santander.initState(state);
    }

    if(!Santander.features[state][type]) {
      Santander.initType(state, type);
    }

    if(Santander.hashes[state][type].indexOf(hash) === -1) {
      if(!Santander.coordinates[state][type][coordinatesKey]) {
        Santander.features[state][type].features.push(feature);
        Santander.hashes[state][type].push(hash);
        Santander.coordinates[state][type][coordinatesKey] = feature;
      } else {
        oldFeature = Santander.coordinates[state][type][coordinatesKey];

        console.log('Duplicated coordinates for ATM: ', oldFeature.properties.name);

        if(!Santander.doesPropertyMatch(oldFeature, feature, 'municipality')) {
          Santander.addProperty(oldFeature, feature, 'municipality');

          console.log('ATM municipality doesn\'t match:', feature.properties.municipality, ',',
            oldFeature.properties.municipality);

          Santander.addIssue(oldFeature, 'municipality');
        }

        if(!Santander.doesPropertyMatch(oldFeature, feature, 'name')) {
          Santander.addProperty(oldFeature, feature, 'name');
          // oldFeature.properties.name.push(feature.properties.name[0]);

          console.log('ATM name doesn\'t match:', feature.properties.name, ',',
            oldFeature.properties.name);

          Santander.addIssue(oldFeature, 'name');
        }

        if(!Santander.doesPropertyMatch(oldFeature, feature, 'atmId')) {
          Santander.addProperty(oldFeature, feature, 'atmId');

          console.log('ATM id doesn\'t match, branch:', feature.properties.branchId, ', id:',
            oldFeature.properties.atmId);

          Santander.addIssue(oldFeature, 'id');
        }

        if(!Santander.doesPropertyMatch(oldFeature, feature, 'address')) {
          Santander.addProperty(oldFeature, feature, 'address');

          console.log('ATM address doesn\'t match:', feature.properties.name, ',',
            oldFeature.properties.address);

          Santander.addIssue(oldFeature, 'address');
        }

        if(!Santander.doesPropertyMatch(oldFeature, feature, 'neighborhood')) {
          Santander.addProperty(oldFeature, feature, 'neighborhood');

          console.log('ATM neighborhood doesn\'t match:', feature.properties.name, ',',
            oldFeature.properties.neighborhood);

          Santander.addIssue(oldFeature, 'neighborhood');
        }
      }
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
        }
      }).parse();

    return options;
  },

  main: function () {
    var promise,
      promiseArray = [],
      options = Santander.getConsoleOptions();

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

    promise.then(function () {
      Santander.makeItRain();
    });
  }
};

Santander.main();
