
// Module dependencies
var crypto            = require('crypto')
  , debug             = require('debug')('oauth')
  , Models            = require('../models')
  , User              = Models.User
  , OAuthAccessToken  = Models.OAuthAccessToken
  , OAuthClient       = Models.OAuthClient


function OAuthModel() { }


// retrieve the access token from the store
OAuthModel.prototype.getAccessToken = function(bearerToken, next) {
  debug('retrieving access token %s', bearerToken);
  OAuthAccessToken.findAccessToken(bearerToken, function(err, accessToken) {
    if(err) return next(err);
    else if(!accessToken) return next(null, null);
    else {
      debug('retrieving associated user %s', accessToken.userId);
      User.findById(accessToken.userId, function(err, user) {        
        if(err) next(err);
        else {
          accessToken.user = user;
          return next(null, accessToken);
        }
      });
    }
  });
}

// gets the client from the client data store
OAuthModel.prototype.getClient = function(clientId, clientSecret, next) {
  debug('querying for client %s', clientId);
  OAuthClient.findClient(clientId, clientSecret, next);
}

// checks if the grant type is allowed
OAuthModel.prototype.grantTypeAllowed = function(clientId, grantType, next) {
  debug('checking for granttype %s', grantType);
  if(grantType === 'password') {
    next(null, true);
  }
}

// saves the access token
OAuthModel.prototype.saveAccessToken = function(accessToken, clientId, expires, user, next) {
  debug('saving access token %s', accessToken);  
  var accessToken = new OAuthAccessToken({
    clientId: clientId,
    accessToken: accessToken,
    expires: expires,
    userId: user.id
  });
  accessToken.save(next);
}

// call out to storage to retrieve the user
OAuthModel.prototype.getUser = function(username, password, next) {
  debug('retrieving user %s', username);
  User.findOne({ username: username }, function(err, user) {
    if(err) next(err);
    else if (user === null) {
      next(null, null);
    }
    else {
      user.verifyPassword(password, function(err, valid) {
        if(err) next(err);
        else next(null, valid ? user : null);
      });
    }
  });
}


///
/// Exports
///
module.exports = OAuthModel;