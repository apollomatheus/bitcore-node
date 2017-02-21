'use strict';

var bitcore = require('bitcore-lib');
var async = require('async');

/**
 * Will retrieve a block as a Bitcore object
 * @param {String|Number} block - A block hash or block height number
 * @param {Function} callback
 */
var getAdminInfo = function(callback) {
  var self = this;

  function getAdminInfo() {

    var cacheAdminInfo = self.adminCache.get('adminInfo');
    if (cacheAdminInfo) {
      return setImmediate(function() {
        callback(null, cacheAdminInfo);
      });
    } else {
      self._tryAllClients(function(client, done) {
        client.getAdminInfo(function(err, response) {
          if (err) {
            return done(self._wrapRPCError(err));
          }
          done(null, response);
        });
      }, callback);
    }
  }
  getAdminInfo();
};

module.exports = {
  getAdminInfo: getAdminInfo
}