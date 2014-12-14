/**
 * Misc helper.
 */

var Helper;

Helper = {
  toSpinalCase: function (string) {
    return string.toLowerCase().replace(/\s+/g, '-');
  }
};

module.exports = Helper;
