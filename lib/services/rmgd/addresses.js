'use strict';

var bitcore = require('bitcore-lib');
var _  = bitcore.deps._;
var $ = bitcore.util.preconditions;
var async = require('async');

/**
 * Will get the balance for an address or multiple addresses
 * @param {String|Address|Array} addressArg - An address string, bitcore address, or array of addresses
 * @param {Object} options
 * @param {Function} callback
 */
var getAddressBalance = function(addressArg, options, callback) {
  var self = this;
  var addresses = self._normalizeAddressArg(addressArg);
  self.getAddressTxids(addresses, { queryMempool: false }, function(err, txids) {
    async.mapSeries(
      txids,
      function(txId, next) {
        self.getDetailedTransaction(txId, next);
      },
      function(err, transactions) {
        if(err) {
          return callback(self._wrapRPCError(err));
        }
        var amountSent = 0, amountReceived = 0;
        transactions.forEach(function(tx) {
          // Inputs
          tx.inputs.forEach(function(input){
            if (input.address && _.indexOf(addresses, input.address[0]) > -1) {
              amountSent += input.satoshis;
            }
          });
          // outputs
          tx.outputs.forEach(function(output){
            if (output.address && _.indexOf(addresses, output.address) > -1) {
              amountReceived += output.satoshis;
            }
          });
        });

        var response = {
          balance: amountReceived - amountSent,
          received: amountReceived
        };

        callback(null, response);
      }
    );
  });
};

/**
 This method can be used to calculate unconfirmed portion of the balance, txids and unspent outputs.
 * @param [String] addresses - List of Addresses for calculation
 * @param {Function} callback
 */
var getAddressMempool = function(addresses, callback) {
  var self = this;
  self._getAddressTxsFromMempool(addresses, function(err, unconfirmedTxs) {
    if (err) {
      return callback(self._wrapRPCError(err));
    }
    var result = [];
    _.forEach(unconfirmedTxs, function(unconfirmedTx) {
      var involvedVout = _.filter(unconfirmedTx.vout, function(vout){
        return vout.scriptPubKey && vout.scriptPubKey.addresses && _.difference(vout.scriptPubKey.addresses, addresses).length === 0;
      });
      for (var i = 0; i < involvedVout.length; i++) {
        // Missing  "timestamp", "prevtxid", "prevout" attributes to make it like the RPC Implementation
        result.push({
          address: involvedVout[i].scriptPubKey.addresses[0],
          txid: unconfirmedTx.txid,
          index: involvedVout[i].n,
          satoshis: new bitcore.Unit.fromBTC(involvedVout[i].value).toSatoshis()
        });
      }
    });
    callback(null, result);
  });
}

var _getBalanceFromMempool = function(deltas) {
  var satoshis = 0;
  for (var i = 0; i < deltas.length; i++) {
    satoshis += deltas[i].satoshis;
  }
  return satoshis;
};

var _getTxidsFromMempool = function(deltas) {
  var mempoolTxids = [];
  var mempoolTxidsKnown = {};
  for (var i = 0; i < deltas.length; i++) {
    var txid = deltas[i].txid;
    if (!mempoolTxidsKnown[txid]) {
      mempoolTxids.push(txid);
      mempoolTxidsKnown[txid] = true;
    }
  }
  return mempoolTxids;
};

/**
 * Will expand into a detailed transaction from a txid
 * @param {Object} txid - A bitcoin transaction id
 * @param {Function} callback
 */
var _getAddressDetailedTransaction = function(txid, options, next) {
  var self = this;

  self.getDetailedTransaction(
    txid,
    function(err, transaction) {
      if (err) {
        return next(err);
      }

      var addressDetails = self._getAddressDetailsForTransaction(transaction, options.addressStrings);

      var details = {
        addresses: addressDetails.addresses,
        satoshis: addressDetails.satoshis,
        confirmations: transaction.confirmations,
        tx: transaction
      };
      next(null, details);
    }
  );
};

var _getAddressStrings = function(addresses) {
  var addressStrings = [];
  for (var i = 0; i < addresses.length; i++) {
    var address = addresses[i];
    if (address instanceof bitcore.Address) {
      addressStrings.push(address.toString());
    } else if (_.isString(address)) {
      addressStrings.push(address);
    } else {
      throw new TypeError('Addresses are expected to be strings');
    }
  }
  return addressStrings;
};

var _paginateTxids = function(fullTxids, fromArg, toArg) {
  var txids;
  var from = parseInt(fromArg);
  var to = parseInt(toArg);
  $.checkState(from < to, '"from" (' + from + ') is expected to be less than "to" (' + to + ')');
  txids = fullTxids.slice(from, to);
  return txids;
};

/**
 * Will detailed transaction history for an address or multiple addresses
 * @param {String|Address|Array} addressArg - An address string, bitcore address, or array of addresses
 * @param {Object} options
 * @param {Function} callback
 */
var getAddressHistory = function(addressArg, options, callback) {
  var self = this;
  var addresses = self._normalizeAddressArg(addressArg);
  if (addresses.length > this.maxAddressesQuery) {
    return callback(new TypeError('Maximum number of addresses (' + this.maxAddressesQuery + ') exceeded'));
  }

  var queryMempool = _.isUndefined(options.queryMempool) ? true : options.queryMempool;
  var addressStrings = this._getAddressStrings(addresses);

  var fromArg = parseInt(options.from || 0);
  var toArg = parseInt(options.to || self.maxTransactionHistory);

  if ((toArg - fromArg) > self.maxTransactionHistory) {
    return callback(new Error(
      '"from" (' + options.from + ') and "to" (' + options.to + ') range should be less than or equal to ' +
      self.maxTransactionHistory
    ));
  }

  self.getAddressTxids(addresses, options, function(err, txids) {
    if (err) {
      return callback(err);
    }

    var totalCount = txids.length;
    try {
      txids = self._paginateTxids(txids, fromArg, toArg);
    } catch(e) {
      return callback(e);
    }

    async.mapLimit(
      txids,
      self.transactionConcurrency,
      function(txid, next) {
        self._getAddressDetailedTransaction(txid, {
          queryMempool: queryMempool,
          addressStrings: addressStrings
        }, next);
      },
      function(err, transactions) {
        if (err) {
          return callback(err);
        }
        callback(null, {
          totalCount: totalCount,
          items: transactions
        });
      }
    );
  });
};

/**
 * Will get the summary including txids and balance for an address or multiple addresses
 * @param {String|Address|Array} addressArg - An address string, bitcore address, or array of addresses
 * @param {Object} options
 * @param {Function} callback
 */
var getAddressSummary = function(addressArg, options, callback) {
  var self = this;
  var summary = {};
  var queryMempool = _.isUndefined(options.queryMempool) ? true : options.queryMempool;
  var summaryTxids = [];
  var mempoolTxids = [];
  var addresses = self._normalizeAddressArg(addressArg);
  var cacheKey = addresses.join('');

  function finishWithTxids() {
    if (!options.noTxList) {
      var allTxids = mempoolTxids.reverse().concat(summaryTxids);
      var fromArg = parseInt(options.from || 0);
      var toArg = parseInt(options.to || self.maxTxids);

      if ((toArg - fromArg) > self.maxTxids) {
        return callback(new Error(
          '"from" (' + fromArg + ') and "to" (' + toArg + ') range should be less than or equal to ' +
          self.maxTxids
        ));
      }
      var paginatedTxids;
      try {
        paginatedTxids = self._paginateTxids(allTxids, fromArg, toArg);
      } catch(e) {
        return callback(e);
      }

      var allSummary = _.clone(summary);
      allSummary.txids = paginatedTxids;
      callback(null, allSummary);
    } else {
      callback(null, summary);
    }
  }

  function querySummary() {
    async.parallel([
      function getTxList(done) {
        self.getAddressTxids(addresses, { queryMempool: true }, function(err, txids) {
          if (err) {
            return done(err);
          }
          summaryTxids = txids;
          summary.appearances = txids.length;

          done();
        });
      },
      function getBalance(done) {
        self.getAddressBalance(addresses, options, function(err, data) {

          if (err) {
            return done(err);
          }

          summary.totalReceived = data.received;
          summary.totalSpent = data.received - data.balance;
          summary.balance = data.balance;
          done();
        });
      },
      function getMempool(done) {
        if (!queryMempool) {
          return done();
        }
        self.getAddressMempool(addresses, function(err, result) {
          if (err) {
            return done(err);
          }
          mempoolTxids = self._getTxidsFromMempool(result);
          summary.unconfirmedAppearances = mempoolTxids.length;
          summary.unconfirmedBalance = self._getBalanceFromMempool(result);
          done();
        });
      }
    ], function(err) {
      if (err) {
        return callback(err);
      }
      self.summaryCache.set(cacheKey, summary);
      finishWithTxids();
    });
  }

  querySummary();

};

// Looks for transactions with 0 confirmation based on several addreses and return the list
// of transactions related to it
var _getAddressTxsFromMempool = function(addresses, callback) {
  var self = this;
  async.mapSeries(
    addresses,
    function(address, nextAddress) {
      self.searchRawTransactions(address, nextAddress);
    },
    function(err, transactions) {
      if (err) {
        return callback(err);
      }
      var unconfirmedTransactions = [];
      // THIS NEEDS TO BE CONFIRMED WITH A MEMPOOL TX
      transactions.forEach(function(addressTxs){
        var unconfirmedTxs = _.filter(addressTxs, function(addressTx) {
          return !addressTx.confirmations || addressTx.confirmations === 0;
        });
        unconfirmedTransactions = unconfirmedTransactions.concat(unconfirmedTxs);
      });
      callback(null, unconfirmedTransactions);
    });
};

var _getHeightRangeQuery = function(options, clone) {
  if (options.start >= 0 && options.end >= 0) {
    if (options.end > options.start) {
      throw new TypeError('"end" is expected to be less than or equal to "start"');
    }
    if (clone) {
      // reverse start and end as the order in bitcore is most recent to less recent
      clone.start = options.end;
      clone.end = options.start;
    }
    return true;
  }
  return false;
};

/**
 * Will get the txids for an address or multiple addresses
 * @param {String|Address|Array} addressArg - An address string, bitcore address, or array of addresses
 * @param {Object} options
 * @param {Function} callback
 */
var getAddressTxids = function(addressArg, options, callback) {
  /* jshint maxstatements: 20 */
  var self = this;
  var queryMempool = _.isUndefined(options.queryMempool) ? true : options.queryMempool;
  var queryMempoolOnly = _.isUndefined(options.queryMempoolOnly) ? false : options.queryMempoolOnly;
  var rangeQuery = false;
  try {
    rangeQuery = self._getHeightRangeQuery(options);
  } catch(err) {
    return callback(err);
  }
  if (rangeQuery) {
    queryMempool = false;
  }
  if (queryMempoolOnly) {
    queryMempool = true;
    rangeQuery = false;
  }
  var addresses = self._normalizeAddressArg(addressArg);
  var cacheKey = addresses.join('');
  var mempoolTxids = [];
  var txids = false;

  function finish() {
    if (queryMempoolOnly) {
      return setImmediate(function() {
        callback(null, mempoolTxids.reverse());
      });
    }
    if (txids && !rangeQuery) {
      var allTxids = mempoolTxids.reverse().concat(txids);
      return setImmediate(function() {
        callback(null, allTxids);
      });
    } else {
      var txidOpts = {
        addresses: addresses
      };
      if (rangeQuery) {
        self._getHeightRangeQuery(options, txidOpts);
      }
      self.client.getAddressTxids(txidOpts, function(err, response) {
        if (err) {
          return callback(self._wrapRPCError(err));
        }
        response.result.reverse();
        if (!rangeQuery) {
          self.txidsCache.set(cacheKey, response.result);
        }
        var allTxids = mempoolTxids.reverse().concat(response.result);
        return callback(null, allTxids);
      });
    }
  }

  if (queryMempool) {
    self.getAddressMempool(addresses, function(err, unconfirmedTxs) {
      if (err) {
        return callback(self._wrapRPCError(err));
      }
      mempoolTxids = self._getTxidsFromMempool(unconfirmedTxs);
      finish();
    });
  } else {
    finish();
  }

};

var _getAddressDetailsForInput = function(input, inputIndex, result, addressStrings) {
  if (!input.address) {
    return;
  }
  var address = input.address;
  if (addressStrings.indexOf(address) >= 0) {
    if (!result.addresses[address]) {
      result.addresses[address] = {
        inputIndexes: [inputIndex],
        outputIndexes: []
      };
    } else {
      result.addresses[address].inputIndexes.push(inputIndex);
    }
    result.satoshis -= input.satoshis;
  }
};

var _getAddressDetailsForOutput = function(output, outputIndex, result, addressStrings) {
  if (!output.address) {
    return;
  }
  var address = output.address;
  if (addressStrings.indexOf(address) >= 0) {
    if (!result.addresses[address]) {
      result.addresses[address] = {
        inputIndexes: [],
        outputIndexes: [outputIndex]
      };
    } else {
      result.addresses[address].outputIndexes.push(outputIndex);
    }
    result.satoshis += output.satoshis;
  }
};
var _getAddressDetailsForTransaction = function(transaction, addressStrings) {
  var result = {
    addresses: {},
    satoshis: 0
  };

  for (var inputIndex = 0; inputIndex < transaction.inputs.length; inputIndex++) {
    var input = transaction.inputs[inputIndex];
    this._getAddressDetailsForInput(input, inputIndex, result, addressStrings);
  }

  for (var outputIndex = 0; outputIndex < transaction.outputs.length; outputIndex++) {
    var output = transaction.outputs[outputIndex];
    this._getAddressDetailsForOutput(output, outputIndex, result, addressStrings);
  }

  $.checkState(Number.isFinite(result.satoshis));

  return result;
};

var _normalizeAddressArg = function(addressArg) {
  var addresses = [addressArg];
  if (Array.isArray(addressArg)) {
    addresses = addressArg;
  }
  return addresses;
};

module.exports = {
  _normalizeAddressArg: _normalizeAddressArg,
  _getAddressDetailsForTransaction: _getAddressDetailsForTransaction,
  _getAddressDetailsForOutput: _getAddressDetailsForOutput,
  _getAddressDetailsForInput: _getAddressDetailsForInput,
  _getHeightRangeQuery: _getHeightRangeQuery,
  _getAddressTxsFromMempool: _getAddressTxsFromMempool,
  _paginateTxids: _paginateTxids,
  _getAddressStrings: _getAddressStrings,
  _getAddressDetailedTransaction: _getAddressDetailedTransaction,
  _getTxidsFromMempool: _getTxidsFromMempool,
  _getBalanceFromMempool: _getBalanceFromMempool,
  getAddressBalance: getAddressBalance,
  getAddressMempool: getAddressMempool,
  getAddressTxids: getAddressTxids,
  getAddressSummary: getAddressSummary,
  getAddressHistory: getAddressHistory
}