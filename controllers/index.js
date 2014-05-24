﻿// Module dependencies
var Rooms         = require('./rooms')
  , Messages      = require('./messages')
  , Users         = require('./users')
  , OAuthClients  = require('./oauthclients');

module.exports = {
  Rooms: Rooms,
  Messages: Messages,
  Users: Users,
  OAuthClients: OAuthClients
}