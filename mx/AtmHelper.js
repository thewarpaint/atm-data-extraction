/**
 * Helper for ATM related functions.
 */
'use strict';

var md5 = require('md5'),
    util = require('util'),
    _ = require('underscore'),
    Helper = require('./Helper'),
    fs = require('fs'),
    AtmHelper;

AtmHelper = {
  bank: {},

  atmNumberedNameRegex: /(.*)\s+\d+$/,

  initState: function (state) {
    AtmHelper.bank.hashes[state] = {};
    AtmHelper.bank.coordinates[state] = {};
    AtmHelper.bank.features[state] = {};
  },

  initType: function (state, type) {
    AtmHelper.bank.hashes[state][type] = [];
    AtmHelper.bank.coordinates[state][type] = {};

    AtmHelper.bank.features[state][type] = {
      type: 'FeatureCollection',
      features: []
    };
  },

  sanitizeNumberedName: function (name) {
    var nameParts;

    if(AtmHelper.atmNumberedNameRegex.test(name)) {
      nameParts = AtmHelper.atmNumberedNameRegex.exec(name);

      if(nameParts.length !== 0) {
        name = nameParts[1];
      }
    }

    return name;
  },

  doesPropertyMatch: function (oldFeature, feature, propertyName) {
    if(typeof oldFeature.properties[propertyName] === 'undefined') {
      throw new Error('Property ' + propertyName + ' does not exist on oldFeature parameter: ' +
        JSON.stringify(oldFeature));
    }

    if(typeof feature.properties[propertyName] === 'undefined') {
      throw new Error('Property ' + propertyName + ' does not exist on feature parameter: ' +
        JSON.stringify(feature));
    }

    if(Array.isArray(oldFeature.properties[propertyName])) {
      return oldFeature.properties[propertyName].indexOf(feature.properties[propertyName]) !== -1;
    }

    return oldFeature.properties[propertyName] === feature.properties[propertyName];
  },

  /**
   * Add a property from a feature to another one. If the property is not yet an array, convert it.
   */
  addProperty: function (oldFeature, feature, propertyName) {
    if(typeof oldFeature.properties[propertyName] === 'undefined') {
      throw new Error('Property ' + propertyName + ' does not exist on oldFeature parameter: ' +
        JSON.stringify(oldFeature));
    }

    if(typeof feature.properties[propertyName] === 'undefined') {
      throw new Error('Property ' + propertyName + ' does not exist on feature parameter: ' +
        JSON.stringify(feature));
    }

    if(feature.properties[propertyName] !== '') {
      if(!Array.isArray(oldFeature.properties[propertyName])) {
        oldFeature.properties[propertyName] = [oldFeature.properties[propertyName]];
      }

      oldFeature.properties[propertyName].push(feature.properties[propertyName]);
      oldFeature.properties[propertyName].sort();
    }

    return oldFeature;
  },

  addIssue: function (feature, issue) {
    if (!feature.properties.issues) {
      feature.properties.issues = [];
    }

    if (feature.properties.issues.indexOf(issue) === -1) {
      feature.properties.issues.push(issue);
    }
  },

  addToState: function (state, type, feature) {
    var hash = md5(JSON.stringify(feature)),
      coordinatesKey = feature.geometry.coordinates.join(','),
      oldFeature;

    if(!AtmHelper.bank.features[state]) {
      AtmHelper.initState(state);
    }

    if(!AtmHelper.bank.features[state][type]) {
      AtmHelper.initType(state, type);
    }

    if(AtmHelper.bank.hashes[state][type].indexOf(hash) === -1) {
      if(!AtmHelper.bank.coordinates[state][type][coordinatesKey]) {
        AtmHelper.bank.features[state][type].features.push(feature);
        AtmHelper.bank.hashes[state][type].push(hash);
        AtmHelper.bank.coordinates[state][type][coordinatesKey] = feature;
      } else {
        oldFeature = AtmHelper.bank.coordinates[state][type][coordinatesKey];

        console.log('Duplicated coordinates for ATM: ', oldFeature.properties.name);

        if(!AtmHelper.doesPropertyMatch(oldFeature, feature, 'municipality')) {
          AtmHelper.addProperty(oldFeature, feature, 'municipality');

          console.log('ATM municipality doesn\'t match:', feature.properties.municipality, ',',
            oldFeature.properties.municipality);

          AtmHelper.addIssue(oldFeature, 'municipality');
        }

        if(!AtmHelper.doesPropertyMatch(oldFeature, feature, 'name')) {
          AtmHelper.addProperty(oldFeature, feature, 'name');

          console.log('ATM name doesn\'t match:', feature.properties.name, ',',
            oldFeature.properties.name);

          AtmHelper.addIssue(oldFeature, 'name');
        }

        if(!AtmHelper.doesPropertyMatch(oldFeature, feature, 'atmId')) {
          AtmHelper.addProperty(oldFeature, feature, 'atmId');

          console.log('ATM id doesn\'t match, branch:', feature.properties.branchId, ', id:',
            oldFeature.properties.atmId);

          AtmHelper.addIssue(oldFeature, 'id');
        }

        if(!AtmHelper.doesPropertyMatch(oldFeature, feature, 'address')) {
          AtmHelper.addProperty(oldFeature, feature, 'address');

          console.log('ATM address doesn\'t match:', feature.properties.name, ',',
            oldFeature.properties.address);

          AtmHelper.addIssue(oldFeature, 'address');
        }

        if(!AtmHelper.doesPropertyMatch(oldFeature, feature, 'neighborhood')) {
          AtmHelper.addProperty(oldFeature, feature, 'neighborhood');

          console.log('ATM neighborhood doesn\'t match:', feature.properties.name, ',',
            oldFeature.properties.neighborhood);

          AtmHelper.addIssue(oldFeature, 'neighborhood');
        }
      }
    }
  },

  makeItRain: function (features, bank) {
    var filename;

    _.each(features, function (types, state) {
      _.each(types, function (featureColl, type) {
        console.log('Writing data for ' + state + ': ' + type);
        featureColl.features = _.sortBy(featureColl.features, function (feature) {
          return feature.properties.branchId + feature.geometry.coordinates.join('');
        });

        filename = util.format('%s/%s-%s.raw.geojson', state, bank, type);
        fs.writeFile(filename, JSON.stringify(featureColl, null, 2));
      });
    });
  },
};

module.exports = AtmHelper;
