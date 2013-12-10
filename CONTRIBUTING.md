# How to contribute #

+ Extraction scripts must be named after the bank they extract information
   from. For example, `bbva-bancomer.py`.
+ Scripts must document the sources and the structure of the documents
   they process.
+ Scripts must accept a command line argument to allow extraction of the
   information of a single state. Optionally, a second argument can be accepted
   to allow the extraction of the info of a single municipality.
+ Extracted information must be saved in [GeoJSON format](http://geojson.org/).
+ Files containing the raw (unprocessed) information obtained must be saved, just in case,
   in a `raw` folder, along with the `.geojson` files. If there is more than
   one of these files, they must obviously have a unique name, associated
   with the parameter used to obtain them, for instance, the municipality
   name or id.
+ In a nutshell, the directory structure must be like this:

 ```
    + country-code
      + state-name
        + bank-name.geojson
        + raw
          + raw-information-file.raw
 ```

 For example:

 ```
    + mx
      + distrito-federal
        + banamex.geojson
        + raw
          + banamex-123.raw
 ```

+ Once all data has been extracted from a bank, clone the repository
   [thewarpaint/atm-locations](https://github.com/thewarpaint/atm-locations),
   copy **only the `.geojson` data** into the directory structure and send a
   Pull Request.

   This feels like double work. What's the point?

   The point is, the `atm-locations` repo is going to be released open source.
   The locations of the ATMs cannot be protected by copyright, but to avoid
   potential trouble, the scripts extracting data from the bank websites will
   not be released and shall remain private.

## To Do ##

+ Simplify the contribution process. Fabric? Submodules? Both?
