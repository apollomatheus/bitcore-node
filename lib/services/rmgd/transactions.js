'use strict';

var bitcore = require('bitcore-lib');
var _  = bitcore.deps._;
var Transaction = bitcore.Transaction;
var index = require('../../');
var log = index.log;

var async = require('async');
/**
 * Will decode a raw transaction
 * @param {String} hex - A block hash or block height number
 * @param {Function} callback
 */
var decodeRawTransaction = function(rawTx, callback) {
  var self = this;

  self._tryAllClients(function(client, done) {
    self.client.decodeRawTransaction(rawTx, function(err, response) {
      if (err) {
        return done(self._wrapRPCError(err));
      }

      done(null, response.result);
    });
  }, callback);
};


/**
 * Will add a transaction to the mempool and relay to connected peers
 * @param {String|Transaction} transaction - The hex string of the transaction
 * @param {Object=} options
 * @param {Boolean=} options.allowAbsurdFees - Enable large fees
 * @param {Function} callback
 */
var sendTransaction = function(tx, options, callback) {
  var self = this;
  var allowAbsurdFees = false;
  if (_.isFunction(options) && _.isUndefined(callback)) {
    callback = options;
  } else if (_.isObject(options)) {
    allowAbsurdFees = options.allowAbsurdFees;
  }

  this.client.sendRawTransaction(tx, allowAbsurdFees, function(err, response) {
    if (err) {
      return callback(self._wrapRPCError(err));
    }
    callback(null, response.result);
  });

};

/**
 * Will get a transaction as a Bitcore Transaction. Results include the mempool.
 * @param {String} txid - The transaction hash
 * @param {Boolean} queryMempool - Include the mempool
 * @param {Function} callback
 */
var getTransaction = function(txid, callback) {
  var self = this;
  var tx = self.transactionCache.get(txid);
  if (tx) {
    return setImmediate(function() {
      callback(null, tx);
    });
  } else {
    self._tryAllClients(function(client, done) {
      client.getRawTransaction(txid, function(err, response) {
        if (err) {
          return done(self._wrapRPCError(err));
        }
        var tx = Transaction();
        tx.fromString(response.result);
        self.transactionCache.set(txid, tx);
        done(null, tx);
      });
    }, callback);
  }
};

/**
 * Will search for transactions filtered by addresses, it includes transactions with 0 confirmations
 * @param {String} address - Address
 * @param {Function} callback
 */
var searchRawTransactions = function(address, callback) {
  var self = this;
  //TODO: CACHE
  self._tryAllClients(function(client, done) {
    client.searchRawTransactions(address, function(err, response) {
      if (err) {
        return done(self._wrapRPCError(err));
      }

      done(null, response.result);
    });
  }, callback);
};

/**
 * Will get a detailed view of a transaction including addresses, amounts and fees.
 *
 * Example result:
 * {
 *   blockHash: '000000000000000002cd0ba6e8fae058747d2344929ed857a18d3484156c9250',
 *   height: 411462,
 *   blockTimestamp: 1463070382,
 *   version: 1,
 *   hash: 'de184cc227f6d1dc0316c7484aa68b58186a18f89d853bb2428b02040c394479',
 *   locktime: 411451,
 *   coinbase: true,
 *   inputs: [
 *     {
 *       prevTxId: '3d003413c13eec3fa8ea1fe8bbff6f40718c66facffe2544d7516c9e2900cac2',
 *       outputIndex: 0,
 *       sequence: 123456789,
 *       script: [hexString],
 *       scriptAsm: [asmString],
 *       address: '1LCTmj15p7sSXv3jmrPfA6KGs6iuepBiiG',
 *       satoshis: 771146
 *     }
 *   ],
 *   outputs: [
 *     {
 *       satoshis: 811146,
 *       script: '76a914d2955017f4e3d6510c57b427cf45ae29c372c99088ac',
 *       scriptAsm: 'OP_DUP OP_HASH160 d2955017f4e3d6510c57b427cf45ae29c372c990 OP_EQUALVERIFY OP_CHECKSIG',
 *       address: '1LCTmj15p7sSXv3jmrPfA6KGs6iuepBiiG',
 *       spentTxId: '4316b98e7504073acd19308b4b8c9f4eeb5e811455c54c0ebfe276c0b1eb6315',
 *       spentIndex: 1,
 *       spentHeight: 100
 *     }
 *   ],
 *   inputSatoshis: 771146,
 *   outputSatoshis: 811146,
 *   feeSatoshis: 40000
 * };
 *
 * @param {String} txid - The hex string of the transaction
 * @param {Function} callback
 */
var getDetailedTransaction = function(txid, callback) {
  var self = this;

  function addInputsToTx(tx, result, transactions) {
    tx.inputs = [];
    tx.inputSatoshis = 0;
    for(var inputIndex = 0; inputIndex < result.vin.length; inputIndex++) {
      var address = null;
      var satoshis = 0;
      var input = result.vin[inputIndex];

      var inputTx = _.find(transactions, function(transaction){
        return transaction.txid === input.txid;
      });
      if (inputTx) {
        var correspondingVout = inputTx.vout[input.vout];
        satoshis = new bitcore.Unit.fromBTC(correspondingVout.value).toSatoshis();

        // Sometimes the rmgd returns a tx.vout without scriptPubKey.addresses, let's validate that first and log the tx
        // for debugging purposes.
        if (correspondingVout && correspondingVout.scriptPubKey && correspondingVout.scriptPubKey.addresses.length > 0) {
          address = correspondingVout.scriptPubKey.addresses[0];
        } else {
          log.info('txid: ' + txid + ' does not have scriptPubKey.addresses');
        }
      }

      if (!tx.coinbase) {
        tx.inputSatoshis += satoshis;
      }
      var script = null;
      var scriptAsm = null;
      if (input.scriptSig) {
        script = input.scriptSig.hex;
        scriptAsm = input.scriptSig.asm;
      } else if (input.coinbase) {
        script = input.coinbase;
      }
      tx.inputs.push({
        prevTxId: input.txid || null,
        outputIndex: _.isUndefined(input.vout) ? null : input.vout,
        script: script,
        scriptAsm: scriptAsm || null,
        sequence: input.sequence,
        address: address,
        satoshis: satoshis
      });
    }
  }

  function addOutputsToTx(tx, result) {
    tx.outputs = [];
    tx.outputSatoshis = 0;
    for(var outputIndex = 0; outputIndex < result.vout.length; outputIndex++) {
      var out = result.vout[outputIndex];
      tx.outputSatoshis += new bitcore.Unit.fromBTC(out.value).toSatoshis();
      var address = null;
      if (out.scriptPubKey && out.scriptPubKey.addresses && out.scriptPubKey.addresses.length === 1) {
        address = out.scriptPubKey.addresses[0];
      }
      tx.outputs.push({
        satoshis: new bitcore.Unit.fromBTC(out.value).toSatoshis(),
        script: out.scriptPubKey.hex,
        scriptAsm: out.scriptPubKey.asm,
        spentTxId: out.spentTxId,
        spentIndex: out.spentIndex,
        spentHeight: out.spentHeight,
        address: address
      });
    }
  }

  self._tryAllClients(function(client, done) {
    client.getRawTransaction(txid, 1, function(err, response) {
      if (err) {
        return done(self._wrapRPCError(err));
      }
      var result = response.result;
      var tx = {
        hex: result.hex,
        blockHash: result.blockhash,
        height: result.height ? result.height : -1,
        blockTimestamp: result.time,
        version: result.version,
        hash: txid,
        locktime: result.locktime,
        confirmations: result.confirmations
      };

      if (result.vin[0] && result.vin[0].coinbase) {
        tx.coinbase = true;
      }

      var txs = _.filter(_.map(result.vin, 'txid'), function(d){
        return d !== undefined;
      });
      async.mapSeries(
        txs,
        function(txid, next) {
          client.getRawTransaction(txid, 1, function(err, response) {
            if (err) {
              return done(self._wrapRPCError(err));
            }
            next(null, response.result);
          });

        },
        function(err, transactions) {
          if(err) {
            callback(err);
          }

          addInputsToTx(tx, result, transactions);
          addOutputsToTx(tx, result);

          if (!tx.coinbase) {
            tx.feeSatoshis = tx.inputSatoshis - tx.outputSatoshis;
          } else {
            tx.feeSatoshis = 0;
          }

          self.transactionDetailedCache.set(txid, tx);
          done(null, tx);

        }
      );

    });
  }, callback);

};

module.exports = {
  decodeRawTransaction: decodeRawTransaction,
  sendTransaction: sendTransaction,
  getTransaction: getTransaction,
  getDetailedTransaction: getDetailedTransaction,
  searchRawTransactions: searchRawTransactions
};