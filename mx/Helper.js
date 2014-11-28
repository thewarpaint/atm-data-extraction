/**
 * Misc helper.
 */

var Helper;

Helper = {
  toSpinalCase: function (string) {
    return string.toLowerCase().replace(/\s+/, '-');
  }
};

module.exports = Helper;
