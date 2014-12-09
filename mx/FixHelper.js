'use strict';

var util = require('util'),
    nomnom = require('nomnom'),
    fs = require('fs');

var FixHelper = {
  rawFilePath: './%s/%s-atm.raw.geojson',
  fixedFilePath: './%s/%s-atm.geojson',

  getConsoleOptions: function () {
    var options = nomnom.script('node FixHelper.js')
      .options({
        bank: {
          position: 0,
          required: true,
          abbr: 'b',
          help: 'Bank'
        },
        state: {
          position: 1,
          required: true,
          abbr: 's',
          help: 'State'
        }
      }).parse();

    return options;
  },

  fixRawFiles: function (bank, state) {
    var featureColl,
        propertyList = ['name', 'municipality', 'neighborhood', 'address'];

    featureColl = JSON.parse(fs.readFileSync(util.format(this.rawFilePath, state, bank), 'utf8'));

    featureColl.features.forEach(function (feature) {
      feature.properties.type = 'ATM';

      propertyList.forEach(function (key) {
        if(Array.isArray(feature.properties[key])) {
          feature.properties[key] = feature.properties[key][0];
        }
      });
    });

    fs.writeFile(util.format(this.fixedFilePath, state, bank), JSON.stringify(featureColl, null, 2));
  },

  main: function () {
    var options = this.getConsoleOptions();

    if(options.state && options.bank) {
      this.fixRawFiles(options.bank, options.state);
    }
  }
};

FixHelper.main();
