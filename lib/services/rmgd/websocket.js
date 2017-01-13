'use strict';

var WebSocket = require('ws');
var index = require('../../');
var log = index.log;

var bitcore = require('bitcore-lib');
var $ = bitcore.util.preconditions;

var webSocketBlockHandler = function(node, message) {
  var self = this;

  // Update the current chain tip
  self._rapidProtectedUpdateTip(node, message);
  // Notify block subscribers
  // TODO: It holds a reference to the known hosts,
  // so it does not emit twice for the same block. Implement this? Required?
  // var id = message.toString('binary');
  // if (!self.zmqKnownBlocks.get(id)) {
  //   self.zmqKnownBlocks.set(id, true);
  //   self.emit('block', message);
  //
  //   for (var i = 0; i < this.subscriptions.hashblock.length; i++) {
  //     this.subscriptions.hashblock[i].emit('bitcoind/hashblock', message.toString('hex'));
  //   }
  // }
  // Emit the new block
  self.emit('block', message);
  for (var i = 0; i < this.subscriptions.hashblock.length; i++) {
    this.subscriptions.hashblock[i].emit('bitcoind/hashblock', message.params[0]);
  }
};

var _rapidProtectedUpdateTip = function(node, message) {
  var self = this;

  // Prevent a rapid succession of tip updates
  if (new Date() - self.lastTip > 1000) {
    self.lastTip = new Date();
    self._updateTip(node, message);
  } else {
    clearTimeout(self.lastTipTimeout);
    self.lastTipTimeout = setTimeout(function() {
      self._updateTip(node, message);
    }, 1000);
  }
};

var _updateTip = function(node, message) {
  var self = this;

  var hex = message.params[0];
  if (hex !== self.tiphash) {
    self.tiphash = message.params[0];

    // reset block valid caches
    self._resetCaches();

    node.client.getBlock(self.tiphash, function(err, response) {
      if (err) {
        var error = self._wrapRPCError(err);
        self.emit('error', error);
      } else {
        self.height = response.result.height;
        $.checkState(self.height >= 0);
        self.emit('tip', self.height);
      }
    });

    if(!self.node.stopping) {
      self.syncPercentage(function(err, percentage) {
        if (err) {
          self.emit('error', err);
        } else {
          if (Math.round(percentage) >= 100) {
            self.emit('synced', self.height);
          }
          log.info('Bitcoin Height:', self.height, 'Percentage:', percentage.toFixed(2));
        }
      });
    }
  }
};

var _getAddressesFromTransaction = function(transaction) {
  var addresses = [];

  for (var i = 0; i < transaction.inputs.length; i++) {
    var input = transaction.inputs[i];
    if (input.script) {
      var inputAddress = input.script.toAddress(this.node.network);
      if (inputAddress) {
        addresses.push(inputAddress.toString());
      }
    }
  }

  for (var j = 0; j < transaction.outputs.length; j++) {
    var output = transaction.outputs[j];
    if (output.script) {
      var outputAddress = output.script.toAddress(this.node.network);
      if (outputAddress) {
        addresses.push(outputAddress.toString());
      }
    }
  }

  return _.uniq(addresses);
};

var _notifyAddressTxidSubscribers = function(txid, transaction) {
  var addresses = this._getAddressesFromTransaction(transaction);
  for (var i = 0; i < addresses.length; i++) {
    var address = addresses[i];
    if(this.subscriptions.address[address]) {
      var emitters = this.subscriptions.address[address];
      for(var j = 0; j < emitters.length; j++) {
        emitters[j].emit('bitcoind/addresstxid', {
          address: address,
          txid: txid
        });
      }
    }
  }
};

var _zmqTransactionHandler = function(node, message) {
  // var self = this;
  // var hash = bitcore.crypto.Hash.sha256sha256(message);
  // var id = hash.toString('binary');
  // if (!self.zmqKnownTransactions.get(id)) {
  //   self.zmqKnownTransactions.set(id, true);
  //   self.emit('tx', message);
  //
  //   // Notify transaction subscribers
  //   for (var i = 0; i < this.subscriptions.rawtransaction.length; i++) {
  //     this.subscriptions.rawtransaction[i].emit('bitcoind/rawtransaction', message.toString('hex'));
  //   }
  //
  //   var tx = bitcore.Transaction();
  //   tx.fromString(message);
  //   var txid = bitcore.util.buffer.reverse(hash).toString('hex');
  //   self._notifyAddressTxidSubscribers(txid, tx);
  //
  // }
  var self = this;
  self.emit('tx', message.params[0]);
};

var _checkSyncedAndSubscribeZmqEvents = function(node) {
  var self = this;
  var interval;

  function checkAndSubscribe(callback) {
    // update tip
    node.client.getBestBlockHash(function(err, response) {
      if (err) {
        return callback(self._wrapRPCError(err));
      }
      var blockhash = new Buffer(response.result, 'hex');
      self.emit('block', blockhash);
      self._updateTip(node, blockhash);

      // check if synced
      node.client.getBlockchainInfo(function(err, response) {
        if (err) {
          return callback(self._wrapRPCError(err));
        }
        var progress = response.result.verificationprogress;
        if (progress >= self.zmqSubscribeProgress) {
          // subscribe to events for further updates
          self._subscribeZmqEvents(node);
          clearInterval(interval);
          callback(null, true);
        } else {
          callback(null, false);
        }
      });
    });
  }

  checkAndSubscribe(function(err, synced) {
    if (err) {
      log.error(err);
    }
    if (!synced) {
      interval = setInterval(function() {
        if (self.node.stopping) {
          return clearInterval(interval);
        }
        checkAndSubscribe(function(err) {
          if (err) {
            log.error(err);
          }
        });
      }, node._tipUpdateInterval || Bitcoin.DEFAULT_TIP_UPDATE_INTERVAL);
    }
  });

};

// https://github.com/btcsuite/btcd/blob/master/docs/json_rpc_api.md#WSExtMethods
var _subscribeWsEvents = function(ws) {
  var self = this;
  var msgs = [
    JSON.stringify({"jsonrpc":"1.0","method":"notifyblocks","params":[],"id":1}),
    JSON.stringify({"jsonrpc":"1.0","method":"notifynewtransactions","params":[true],"id":2})
  ];
  msgs.forEach(function(msg){
    ws.send(msg);
  });
};

var _initWsSubSocket = function(node, config) {
  var self = this;
  var wsUrl = 'wss://' + config.rpclimituser + ':' + config.rpclimitpass + '@' + config.rpchost + ':' + config.rpcport + '/ws';
  var ws = new WebSocket(wsUrl, {rejectUnauthorized:false});
  ws.on('open', function open() {
    self._subscribeWsEvents(ws);
  });
  ws.on('message', function(message){
    message = JSON.parse(message);
    if (message.error) {
      return;
    }

    if (message.method === 'blockconnected'){
      self.webSocketBlockHandler(node, message);
    } else if (message.method === 'txacceptedverbose'){
      self._zmqTransactionHandler(node, message);
    }
  });
}

var _subscribeZmqEvents = function(node) {
  var self = this;
  node.zmqSubSocket.subscribe('hashblock');
  node.zmqSubSocket.subscribe('rawtx');
  node.zmqSubSocket.on('message', function(topic, message) {
    var topicString = topic.toString('utf8');
    if (topicString === 'rawtx') {
      self._zmqTransactionHandler(node, message);
    } else if (topicString === 'hashblock') {
      self.webSocketBlockHandler(node, message);
    }
  });
};

 module.exports = {
   _subscribeZmqEvents: _subscribeZmqEvents,
   _initWsSubSocket: _initWsSubSocket,
   _subscribeWsEvents: _subscribeWsEvents,
   _checkSyncedAndSubscribeZmqEvents: _checkSyncedAndSubscribeZmqEvents,
   _zmqTransactionHandler: _zmqTransactionHandler,
   _notifyAddressTxidSubscribers: _notifyAddressTxidSubscribers,
   _getAddressesFromTransaction: _getAddressesFromTransaction,
   _updateTip: _updateTip,
   _rapidProtectedUpdateTip: _rapidProtectedUpdateTip,
   webSocketBlockHandler: webSocketBlockHandler
 };