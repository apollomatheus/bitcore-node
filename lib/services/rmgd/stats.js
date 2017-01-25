'use strict';

/**
 * This will return information about the database in the format:
 * {
 *   version: 110000,
 *   protocolVersion: 70002,
 *   blocks: 151,
 *   timeOffset: 0,
 *   connections: 0,
 *   difficulty: 4.6565423739069247e-10,
 *   testnet: false,
 *   network: 'testnet'
 *   relayFee: 1000,
 *   errors: ''
 * }
 * @param {Function} callback
 */
var getInfo = function(callback) {
  var self = this;
  this.client.getInfo(function(err, response) {
    if (err) {
      return callback(self._wrapRPCError(err));
    }
    var result = response.result;
    var info = {
      version: result.version,
      protocolVersion: result.protocolversion,
      blocks: result.blocks,
      timeOffset: result.timeoffset,
      connections: result.connections,
      proxy: result.proxy,
      difficulty: result.difficulty,
      testnet: result.testnet,
      relayFee: result.relayfee,
      errors: result.errors,
      network: self.node.getNetworkName()
    };
    callback(null, info);
  });
};

module.exports = {
  getInfo: getInfo
};