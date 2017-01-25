'use strict'

var Service = require('../../service');
var LRU = require('lru-cache');
var util = require('util');

var getAPIMethods = require('./api').getAPIMethods;
var service = require('./service');
var common = require('./common');
var stats = require('./stats');
var blocks = require('./blocks');
var transactions = require('./transactions');
var addresses = require('./addresses');
var admin = require('./admin');
var subscriptions = require('./subscriptions');
var websockets = require('./websocket');

/**
 * Provides a friendly event driven API to RMGDd in Node.js. Manages starting and
 * stopping RMGDd as a child process for application support, as well as connecting
 * to multiple RMGDd processes for server infrastructure. Results are cached in an
 * LRU cache for improved performance and methods added for common queries.
 *
 * @param {Object} options
 * @param {Node} options.node - A reference to the node
 */
function RMGD(options) {
  if (!(this instanceof RMGD)) {
    return new RMGD(options);
  }

  Service.call(this, options);
  this.options = options;

  this._initCaches();

  // RMGDd child process
  this.spawn = false;

  // event subscribers
  this.subscriptions = {};
  this.subscriptions.rawtransaction = [];
  this.subscriptions.hashblock = [];
  this.subscriptions.address = {};

  // set initial settings
  this._initDefaults(options);

  // available RMGDd nodes
  this._initClients();

  // for testing purposes
  this._process = options.process || process;

  this.on('error', function(err) {
    log.error(err.stack);
  });
}
util.inherits(RMGD, Service);

RMGD.dependencies = [];

RMGD.DEFAULT_MAX_TXIDS = 1000;
RMGD.DEFAULT_MAX_HISTORY = 50;
RMGD.DEFAULT_SHUTDOWN_TIMEOUT = 15000;
RMGD.DEFAULT_ZMQ_SUBSCRIBE_PROGRESS = 0.9999;
RMGD.DEFAULT_MAX_ADDRESSES_QUERY = 10000;
RMGD.DEFAULT_SPAWN_RESTART_TIME = 5000;
RMGD.DEFAULT_SPAWN_STOP_TIME = 10000;
RMGD.DEFAULT_TRY_ALL_INTERVAL = 1000;
RMGD.DEFAULT_REINDEX_INTERVAL = 10000;
RMGD.DEFAULT_START_RETRY_INTERVAL = 5000;
RMGD.DEFAULT_TIP_UPDATE_INTERVAL = 15000;
RMGD.DEFAULT_TRANSACTION_CONCURRENCY = 5;
RMGD.DEFAULT_CONFIG_SETTINGS = {
  server: 1,
  whitelist: '127.0.0.1',
  txindex: 1,
  addressindex: 1,
  timestampindex: 1,
  spentindex: 1,
  zmqpubrawtx: 'tcp://127.0.0.1:28332',
  zmqpubhashblock: 'tcp://127.0.0.1:28332',
  rpcallowip: '127.0.0.1',
  rpcuser: 'RMGD',
  rpcpassword: 'local321',
  uacomment: 'bitcore'
};

RMGD.prototype._initCaches = function() {
  // caches valid until there is a new block
  this.utxosCache = LRU(50000);
  this.txidsCache = LRU(50000);
  this.balanceCache = LRU(50000);
  this.summaryCache = LRU(50000);
  this.blockOverviewCache = LRU(144);
  this.transactionDetailedCache = LRU(100000);

  // caches valid indefinitely
  this.transactionCache = LRU(100000);
  this.rawTransactionCache = LRU(50000);
  this.blockCache = LRU(144);
  this.adminCache = LRU(144);
  this.rawBlockCache = LRU(72);
  this.blockHeaderCache = LRU(288);
  this.zmqKnownTransactions = LRU(5000);
  this.zmqKnownBlocks = LRU(50);
  this.lastTip = 0;
  this.lastTipTimeout = false;
};

RMGD.prototype._resetCaches = function() {
  this.transactionDetailedCache.reset();
  this.utxosCache.reset();
  this.txidsCache.reset();
  this.balanceCache.reset();
  this.summaryCache.reset();
  this.blockOverviewCache.reset();
};

RMGD.prototype._initDefaults = function(options) {
  /* jshint maxcomplexity: 15 */

  // limits
  this.maxTxids = options.maxTxids || RMGD.DEFAULT_MAX_TXIDS;
  this.maxTransactionHistory = options.maxTransactionHistory || RMGD.DEFAULT_MAX_HISTORY;
  this.maxAddressesQuery = options.maxAddressesQuery || RMGD.DEFAULT_MAX_ADDRESSES_QUERY;
  this.shutdownTimeout = options.shutdownTimeout || RMGD.DEFAULT_SHUTDOWN_TIMEOUT;

  // spawn restart setting
  this.spawnRestartTime = options.spawnRestartTime || RMGD.DEFAULT_SPAWN_RESTART_TIME;
  this.spawnStopTime = options.spawnStopTime || RMGD.DEFAULT_SPAWN_STOP_TIME;

  // try all interval
  this.tryAllInterval = options.tryAllInterval || RMGD.DEFAULT_TRY_ALL_INTERVAL;
  this.startRetryInterval = options.startRetryInterval || RMGD.DEFAULT_START_RETRY_INTERVAL;

  // rpc limits
  this.transactionConcurrency = options.transactionConcurrency || RMGD.DEFAULT_TRANSACTION_CONCURRENCY;

  // sync progress level when zmq subscribes to events
  this.zmqSubscribeProgress = options.zmqSubscribeProgress || RMGD.DEFAULT_ZMQ_SUBSCRIBE_PROGRESS;
};

RMGD.prototype._initClients = function() {
  var self = this;
  this.nodes = [];
  this.nodesIndex = 0;
  Object.defineProperty(this, 'client', {
    get: function() {
      var client = self.nodes[self.nodesIndex].client;
      self.nodesIndex = (self.nodesIndex + 1) % self.nodes.length;
      return client;
    },
    enumerable: true,
    configurable: false
  });
};
// Service configuration
RMGD.prototype._connectProcess = service._connectProcess;
RMGD.prototype._spawnChildProcess = service._spawnChildProcess;
RMGD.prototype._stopSpawnedRMGD = service._stopSpawnedRMGD;
RMGD.prototype._getNetworkOption = service._getNetworkOption;
RMGD.prototype._getNetworkConfigPath = service._getNetworkConfigPath;
RMGD.prototype._getDefaultConf = service._getDefaultConf;
RMGD.prototype._checkConfigIndexes = service._checkConfigIndexes;
RMGD.prototype._checkReindex = service._checkReindex;
RMGD.prototype._loadTipFromNode = service._loadTipFromNode;
RMGD.prototype._loadSpawnConfiguration = service._loadSpawnConfiguration;
RMGD.prototype._expandRelativeDatadir = service._expandRelativeDatadir;
RMGD.prototype._parseRMGDConf = service._parseRMGDConf;
RMGD.prototype._getDefaultConfig = service._getDefaultConfig;
RMGD.prototype._initChain = service._initChain;
RMGD.prototype._parseBitcoinConf = service._parseBitcoinConf;
RMGD.prototype._stopSpawnedBitcoin = service._stopSpawnedBitcoin;
RMGD.prototype.start = service.start;
RMGD.prototype.stop = service.stop;
// Event subscriptions
RMGD.prototype.getPublishEvents = subscriptions.getPublishEvents;
RMGD.prototype.subscribe = subscriptions.subscribe;
RMGD.prototype.unsubscribe = subscriptions.unsubscribe;
RMGD.prototype.subscribeAddress =  subscriptions.subscribeAddress;
RMGD.prototype.unsubscribeAddress = subscriptions.unsubscribeAddress;
RMGD.prototype.unsubscribeAddressAll = subscriptions.unsubscribeAddressAll;
// Common
RMGD.prototype._tryAllClients = common._tryAllClients;
RMGD.prototype._wrapRPCError = common._wrapRPCError;
// Stats
RMGD.prototype.isSynced = stats.isSynced;
RMGD.prototype.getInfo = stats.getInfo;
RMGD.prototype.getSpentInfo = stats.getSpentInfo;
RMGD.prototype.estimateFee = stats.estimateFee;
RMGD.prototype.syncPercentage = stats.syncPercentage;
// Blocks
RMGD.prototype._maybeGetBlockHash = blocks._maybeGetBlockHash;
RMGD.prototype.getRawBlock = blocks.getRawBlock;
RMGD.prototype.getBlockOverview = blocks.getBlockOverview;
RMGD.prototype.getBlock = blocks.getBlock;
RMGD.prototype.getBlockHeader = blocks.getBlockHeader;
RMGD.prototype.getBestBlockHash = blocks.getBestBlockHash;
RMGD.prototype.generateBlock = blocks.generateBlock;
// Transactions
RMGD.prototype.decodeRawTransaction = transactions.decodeRawTransaction;
RMGD.prototype.sendTransaction = transactions.sendTransaction;
RMGD.prototype.getRawTransaction = transactions.getRawTransaction;
RMGD.prototype.getTransaction = transactions.getTransaction;
RMGD.prototype.getDetailedTransaction = transactions.getDetailedTransaction;
RMGD.prototype.searchRawTransactions = transactions.searchRawTransactions;
// Addresses
RMGD.prototype._normalizeAddressArg = addresses._normalizeAddressArg;
RMGD.prototype._getAddressDetailsForTransaction = addresses._getAddressDetailsForTransaction;
RMGD.prototype._getAddressDetailsForOutput = addresses._getAddressDetailsForOutput;
RMGD.prototype._getAddressDetailsForInput = addresses._getAddressDetailsForInput;
RMGD.prototype._getHeightRangeQuery = addresses._getHeightRangeQuery;
RMGD.prototype._getAddressTxsFromMempool = addresses._getAddressTxsFromMempool;
RMGD.prototype._paginateTxids = addresses._paginateTxids;
RMGD.prototype._getAddressStrings = addresses._getAddressStrings;
RMGD.prototype._getAddressDetailedTransaction = addresses._getAddressDetailedTransaction;
RMGD.prototype._getTxidsFromMempool = addresses._getTxidsFromMempool;
RMGD.prototype._getBalanceFromMempool = addresses._getBalanceFromMempool;
RMGD.prototype.getAddressBalance = addresses.getAddressBalance;
RMGD.prototype.getAddressMempool = addresses.getAddressMempool;
RMGD.prototype.getAddressTxids = addresses.getAddressTxids;
RMGD.prototype.getAddressSummary = addresses.getAddressSummary;
RMGD.prototype.getAddressHistory = addresses.getAddressHistory;
// Admin
RMGD.prototype.getadmininfo = admin.getadmininfo;
// Websocket
RMGD.prototype._subscribeZmqEvents = websockets._subscribeZmqEvents;
RMGD.prototype._initWsSubSocket = websockets._initWsSubSocket;
RMGD.prototype._subscribeWsEvents = websockets._subscribeWsEvents;
RMGD.prototype._checkSyncedAndSubscribeZmqEvents = websockets._checkSyncedAndSubscribeZmqEvents;
RMGD.prototype._zmqTransactionHandler = websockets._zmqTransactionHandler;
RMGD.prototype._notifyAddressTxidSubscribers = websockets._notifyAddressTxidSubscribers;
RMGD.prototype._getAddressesFromTransaction = websockets._getAddressesFromTransaction;
RMGD.prototype._updateTip = websockets._updateTip;
RMGD.prototype._rapidProtectedUpdateTip = websockets._rapidProtectedUpdateTip;
RMGD.prototype.webSocketBlockHandler = websockets.webSocketBlockHandler;

// API Definition
RMGD.prototype.getAPIMethods = getAPIMethods;

exports.RMGD = RMGD;