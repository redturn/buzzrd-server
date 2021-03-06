
// Module dependencies
var util        = require('util')
  , Q           = require('q')
  , mongoose    = require('mongoose')
  , Schema      = mongoose.Schema
  , debug       = require('debug')('venue')
  , debugSort   = require('debug')('venue:sort')
  , config      = require('../common/confighelper').env()
  , foursquare  = require('node-foursquare-venues')(config.foursquare.clientId, config.foursquare.clientSecret)
  , Room        = require('./room')
  , Location    = require('./location');

///
/// Schema definition
///

var VenueCategory = {
  name: String,
  pluralName: String,
  shortName: String,
  icon: Object
};

var VenueSchema = new Schema({
  name: String,
  coord: { type: [ Number ], index: '2dsphere' },
  location: Location,
  categories: [ VenueCategory ],
  verified: Boolean,
  referralId: String,
  created: { type: Date, default: Date.now },
  updated: { type: Date, default: Date.now },
  roomCount: { type: Number, default: 0 },
  userCount: { type: Number, default: 0 },
  lastMessage: { type: Date },
  messageCount: { type: Number, default: 0 }
});

var VenueSearchSchema = new Schema({
  lng: { type: Number },
  lat: { type: Number },
  search: { type: String },
  results: { type: Number, default: 0 },
  created: { type: Date, default: Date.now },
  updated: { type: Date, default: Date.now }
});
VenueSearchSchema.index({ lng: 1, lat: 1, search: 1 }, { unique: true });



///
/// Statics
///

/**
 * findById
 * Finds a venue by identifier
 * @param id identifier for the venue
 */
VenueSchema.statics.findById = function(id, next) {
  debug('findById ' + id);

  Venue.findOne({
    _id: new mongoose.Types.ObjectId(id)
  }, next);
}


/**
 * Finds the venues with the supplied Ids
 * 
 * @param [String] ids
 */
VenueSchema.statics.findVenues = function(ids, next) {
  debug('findVenues %s', ids.length);

  ids = ids.map(function(id) { 
    return new mongoose.Types.ObjectId(id);
  });

  Venue.find({ 
    _id: { $in: ids }
  }, next);
}



/** 
 * findNearbyWithRooms
 * Finds locations neara latitude, longitude coordinate within
 * the specified number of meters 
 * @param lat latitude part of coordinate pair
 * @param lng longitude part of coordinate pair
 * @param meters limits results to meter radius of coordinates
 * @param next node callback of form (err, [Venue])
 */
VenueSchema.statics.findNearbyWithRooms = function(lat, lng, meters, next) {
  debug('querying store for venues with rooms');




  this.find({ 
    "roomCount": { $gt: 0 },
    "coord": { 
      "$near" : { 
        "$geometry" : { type: "Point", coordinates: [ lng, lat ] }, 
        "$maxDistance" : meters 
      }
    }
  })
  .limit(100)   // 100 is the max returned for $near op
  .exec(function(err, venues) {

    if(err) next(err);
    else next(null, sort(lat, lng, venues));

  });
}

/** 
 * findNearby
 * Finds locations near a  latitude, longitude coordinate within
 * the specified number of meters of that coordinate ordered by proximity
 * @params options
 *   @param lat latitude part of coordinate pair
 *   @param lng longitude part of coordinate pair
 *   @param radius limits results to meter radius of coordinates
 *   @param search the text to search for
 * @param next node callback of form (err, [Venue])
 */
VenueSchema.statics.findNearby = function(options, next) {
  debug('findNearby lat: %d, lng: %d, %dm', options.lat, options.lng, options.meters);

  // check for recent searches  
  VenueSearch.findRecentSearch(options, function(err, search) {

    // if there is a recent search
    if(search) {
      debug('search cache hit');
      Venue.findNearbyFromCache(options, next);
    } 

    // if there isn't a recent search
    else {
      debug('search cache miss');
      Venue.findNearbyFromFoursquare(options, next);
    }

  });
}

/** 
 * findNearbyFromCache
 * Retrieves the venues from the cache
 */
VenueSchema.statics.findNearbyFromCache = function(options, next) {
  debug('querying venue cache');

  var search = { 
    "coord": { 
      "$near" : { 
        "$geometry" : { type: "Point", coordinates: [ options.lng, options.lat ] }, 
        "$maxDistance" : options.meters 
      }
    }
  };

  if(options.search) {
    search.name = new RegExp(options.search, "i");
  }

  this.find(search)
  .limit(50)
  .exec(next);
}

/** 
 * findNearbyFromFoursquare
 * Retrieves the venues from the Foursquare API and 
 * updates the venue cache with the latest info
 */
VenueSchema.statics.findNearbyFromFoursquare = function(options, next) {
  debug('executing foursqaure venue search');
  
  // construct search
  var search = { 
    ll: util.format('%s,%s', options.lat, options.lng),
    limit:  50,
    radius: options.meters,
    query: options.search
  };

  // exceute the foursquare search
  foursquare.venues.search(search, function(err, results) {
    if(err) next(results);
    else {            
      debug('foursquare responded with %s venues', results.response.venues.length);
      VenueSearch.logSearch(options, results.response.venues);
      Venue.upsertVenues(results.response.venues, next);
    }
  });
}

/** 
 * upsertVenues
 * Insert or updates the venues
 * @param [Venue] venues
 * @param function(err, [Venue]) callback function
 * @remarks This fires off an upsert for each venue in the list
 *          and has the potential to be very costly for large
 *          lists of venues. Use with caution... possibly add
 *          a check to throw an exception if array is too large
 */ 
VenueSchema.statics.upsertVenues = function(venues, next) {
  debug('upserting %d venues', venues.length);
  
  // upsert all of the venues
  Q.all(

    // create a promise for each venue
    venues.map(function(venue) {    
      var search = {
          _id: mongoose.Types.ObjectId(venue.id)
        },
        categories = venue.categories.map(function(category) {
          category._id = new mongoose.Types.ObjectId(category.id);
          delete category.id;
          return category;
        }),
        data = {
          _id: venue.id,
          name: venue.name,
          location: venue.location,
          categories: categories,
          verified: venue.verified,
          referralId: venue.referralId,
          coord: [ venue.location.lng, venue.location.lat ],
          updated: Date.now(),
          $setOnInsert: { 
            created: Date.now(), 
            roomCount: 0,
            userCount: 0
          }
        };      
      return Q.ninvoke(Venue, "findOneAndUpdate", search, data, { upsert: true });
    })
  )
  .then(function(venue) {
    next(null, venue);
  })
  .fail(function(err) {
    next(err);
  });

}



///
/// Instance methods
///


/** 
 * toClient
 * @override
 * To client method that will also include rooms if they are available
 */
VenueSchema.methods.toClient = function() {
  var client = mongoose.Model.prototype.toClient.call(this);
  if(this.rooms) {
    client.rooms = this.rooms.map(function(room) {
      return room.toClient();
    });
  }  
  return client;
}


///
/// Helper functions
/// 

/** 
 * Rounds a float to the decimal precision
 */
Math.roundp = function(number, precision) {
  return parseFloat(parseFloat(number).toFixed(precision));
}







///
/// VenueSearch
///

/** 
 * Finds a recent search within the last day
 */
VenueSearchSchema.statics.findRecentSearch = function(options, next) {

  var lng = Math.roundp(options.lng, 4)
    , lat = Math.roundp(options.lat, 4)
    , conditions;

  condition = {
    lng: lng,
    lat: lat,
    search: options.search || null
  }

  this.findOne(condition, function(err, result) {
    var daysAgo = 1
      , pastDate = new Date();

    pastDate.setDate(pastDate.getDate() - 1);

    if(err) next(err);
    else {      
      if(!result || result.updated < pastDate) {
        next(null, null);
      } else {
        next(null, result);
      }
    }
  })

}

/** 
 * Inserts or updates a log entry
 */
VenueSearchSchema.statics.logSearch = function(options, venues) {
  debug('logging venue search');

  var lng = Math.roundp(options.lng, 4) 
    , lat = Math.roundp(options.lat, 4)
    , search = options.search || null
    , condition
    , update
    , options;

  condition = { 
    lng: lng,
    lat: lat,
    search: search
  };

  update = {
    lng: lng,
    lat: lat,
    search: search,
    results: venues.length,
    updated: Date.now(),
    $setOnInsert: { 
      created: Date.now()          
    }     
  };

  options = {
    upsert: true
  };

  this.findOneAndUpdate(condition, update, options, function(err, result) {
    if(err) console.log(err);
  });
}





///
/// Create and export the model
///
var Venue = mongoose.model("Venue", VenueSchema);
var VenueSearch = mongoose.model('VenueSearch', VenueSearchSchema);
module.exports = Venue;

