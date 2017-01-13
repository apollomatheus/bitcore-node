'use strict';

var bitcore = require('bitcore-lib');
var _  = bitcore.deps._;

var index = require('../../');
var log = index.log;

/**
 * Called by the Bus to determine the available events.
 */
var getPublishEvents = function() {
  return [
    {
      name: 'bitcoind/rawtransaction',
      scope: this,
      subscribe: this.subscribe.bind(this, 'rawtransaction'),
      unsubscribe: this.unsubscribe.bind(this, 'rawtransaction')
    },
    {
      name: 'bitcoind/hashblock',
      scope: this,
      subscribe: this.subscribe.bind(this, 'hashblock'),
      unsubscribe: this.unsubscribe.bind(this, 'hashblock')
    },
    {
      name: 'bitcoind/addresstxid',
      scope: this,
      subscribe: this.subscribeAddress.bind(this),
      unsubscribe: this.unsubscribeAddress.bind(this)
    }
  ];
};

var subscribe = function(name, emitter) {
  this.subscriptions[name].push(emitter);
  log.info(emitter.remoteAddress, 'subscribe:', 'bitcoind/' + name, 'total:', this.subscriptions[name].length);
};

var unsubscribe = function(name, emitter) {
  var index = this.subscriptions[name].indexOf(emitter);
  if (index > -1) {
    this.subscriptions[name].splice(index, 1);
  }
  log.info(emitter.remoteAddress, 'unsubscribe:', 'bitcoind/' + name, 'total:', this.subscriptions[name].length);
};

var subscribeAddress = function(emitter, addresses) {
  var self = this;

  function addAddress(addressStr) {
    if(self.subscriptions.address[addressStr]) {
      var emitters = self.subscriptions.address[addressStr];
      var index = emitters.indexOf(emitter);
      if (index === -1) {
        self.subscriptions.address[addressStr].push(emitter);
      }
    } else {
      self.subscriptions.address[addressStr] = [emitter];
    }
  }

  for(var i = 0; i < addresses.length; i++) {
    if (bitcore.Address.isValid(addresses[i], this.node.network)) {
      addAddress(addresses[i]);
    }
  }

  log.info(emitter.remoteAddress, 'subscribe:', 'bitcoind/addresstxid', 'total:', _.size(this.subscriptions.address));
};

var unsubscribeAddress = function(emitter, addresses) {
  var self = this;
  if(!addresses) {
    return this.unsubscribeAddressAll(emitter);
  }

  function removeAddress(addressStr) {
    var emitters = self.subscriptions.address[addressStr];
    var index = emitters.indexOf(emitter);
    if(index > -1) {
      emitters.splice(index, 1);
      if (emitters.length === 0) {
        delete self.subscriptions.address[addressStr];
      }
    }
  }

  for(var i = 0; i < addresses.length; i++) {
    if(this.subscriptions.address[addresses[i]]) {
      removeAddress(addresses[i]);
    }
  }

  log.info(emitter.remoteAddress, 'unsubscribe:', 'bitcoind/addresstxid', 'total:', _.size(this.subscriptions.address));
};

/**
 * A helper function for the `unsubscribe` method to unsubscribe from all addresses.
 * @param {String} name - The name of the event
 * @param {EventEmitter} emitter - An instance of an event emitter
 */
var unsubscribeAddressAll = function(emitter) {
  for(var hashHex in this.subscriptions.address) {
    var emitters = this.subscriptions.address[hashHex];
    var index = emitters.indexOf(emitter);
    if(index > -1) {
      emitters.splice(index, 1);
    }
    if (emitters.length === 0) {
      delete this.subscriptions.address[hashHex];
    }
  }
  log.info(emitter.remoteAddress, 'unsubscribe:', 'bitcoind/addresstxid', 'total:', _.size(this.subscriptions.address));
};

module.exports = {
  getPublishEvents: getPublishEvents,
  subscribe: subscribe,
  unsubscribe: unsubscribe,
  subscribeAddress: subscribeAddress,
  unsubscribeAddress: unsubscribeAddress,
  unsubscribeAddressAll: unsubscribeAddressAll
};
