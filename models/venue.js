
// Module dependencies
var mongoose  = require('mongoose')
  , Q         = require('q')
  , Schema    = mongoose.Schema;

///
/// Schema definition
///
var Location = {
  address: String,
  lat: Number,
  lng: Number,
  cc: String,
  city: String,
  state: String,
  country: String  
};

var VenueCategory = {
  id: String,
  name: String,
  pluralName: String,
  shortName: String,
  icon: Object
};

var VenueSchema = new Schema({
  id: { type: String, index: { unique: true } },
  name: String,
  coord: { type: [ Number ], index: '2dsphere' },
  location: Location,
  categories: [ VenueCategory ],
  verified: Boolean,
  referralId: String,
  created: { type: Date, default: Date.now },
  updated: { type: Date, default: Date.now }
});



///
/// Statics
///

/** 
 * findNearby
 * Finds locations near a  latitude, longitude coordinate within
 * the specified number of meters of that coordinate
 */
VenueSchema.statics.findNearby = function(lat, lng, meters, next) {


  this.find({ 
    "coord": { 
      "$near" : { 
        "$geometry" : { type: "Point", coordinates: [ lng, lat ] }, 
        "$maxDistance" : meters 
      }
    }
  }, next);
}

/** 
 * upsertVenues
 * Insert or updates the venues
 */ 
VenueSchema.statics.upsertVenues = function(venues, next) {

  var promises = [];

  // construct upsert data
  venues.forEach(function(venue) {    
    venue.updated = Date.now();
    venue["$setOnInsert"] = { created: Date.now() };
    venue.coord = [ venue.location.lng, venue.location.lat ];
    promises.push(Q.ninvoke(Venue, "findOneAndUpdate", { id: venue.id }, venue, { upsert: true }));
  });
  
  // upsert all of the venues
  Q.all(promises)
  .then(function(results) {
    next(null, results)
  }, function(err) {
    next(err);
  });

}


///
/// Create and export the model
///
var model = Venue = mongoose.model("Venue", VenueSchema);
module.exports = model;