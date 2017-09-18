const addressHandler =  require('../../../lib/services/rmgd/addresses');
var expect = require('chai').expect;

describe('Addresses', function() {
  it('should calculate the wallet balance correctly', function() {
    const transactions = [{
      "hash": "66197c8d5a0eb6528dda204f406664e5575d7e0b6f6b8b9b0d4ade3881f859bd",
      "inputs": [{
        "outputIndex": 0,
        "address": "TE5ARa7Wsq9w9cm39P6NkhDmBgtACSEvzzgPcGrpttT97",
        "satoshis": 499982700000000
      }],
      "inputSatoshis": 499982700000000,
      "outputs": [{
        "satoshis": 499981900000000,
        "address": "TEqPXsUupb4jhdCSmkohmob8eF1ahdTwWvgsTUpjs24Dr",
      }, {
        "satoshis": 800000000,
        "address": "TGEnkqNT2xxJKiPr3PJhhoWGu9pxeE3J2dorrk5Ph8UxU",
      }],
      "outputSatoshis": 499982700000000,
      "feeSatoshis": 0
    }, {
      "hash": "1ba4151b8eb77467f23d800e238b7eb95c1ae832e973ee07ef05b52734377d93",
      "inputs": [{
        "outputIndex": 0,
        "address": "TGEnkqNT2xxJKiPr3PJhhoWGu9pxeE3J2dorrk5Ph8UxU",
        "satoshis": 5000000000
      }],
      "inputSatoshis": 5000000000,
      "outputs": [{
        "satoshis": 4700000000,
        "address": "TBjxPKaWz4dvoZrJ9htaQhYfAAswRfPPinW8Vb2bJaRxx",
      }, {
        "satoshis": 300000000,
        "address": "THh3sso9BP7B1MhZmkNFgUY9He8ageQskvvHmUFSsys6C",
      }],
      "outputSatoshis": 5000000000,
      "feeSatoshis": 0
    }, {
      "hash": "c5586e66d12777d3e09d7ad14d508d693edf5a673e724faaac1e7366af19e4e6",
      "inputs": [{
        "outputIndex": 0,
        "address": "THsh9NCUJi28K6ehi4HuV1UwF3CkQ2LfiqhsrcqjT4RFT",
        "satoshis": 499988200000000
      }],
      "inputSatoshis": 499988200000000,
      "outputs": [{
        "satoshis": 1000000000,
        "address": "TGEnkqNT2xxJKiPr3PJhhoWGu9pxeE3J2dorrk5Ph8UxU",
      }, {
        "satoshis": 499987200000000,
        "address": "TSBt1xZJtWUkeuwkNhhAQQAqie94trH9a6qkeP4T4BYWv",
      }],
      "outputSatoshis": 499988200000000,
      "feeSatoshis": 0
    }, {
      "hash": "789bc4463ac0b834cb9b1bdec1c13e596842525ad52348f4d4b2e5ec07bfa4dd",
      "inputs": [{
        "outputIndex": 1,
        "address": "TJJgQv9Zxfo6F2LRm2Z59nMg2zorUazN3Zdj4hXHE9TTb",
        "satoshis": 200000000
      }, {
        "outputIndex": 0,
        "address": "TL4EobJ4TR8LpeKJVJ5F9rzLYrdrdWnkiY3YkvP4hFQts",
        "satoshis": 499989000000000
      }],
      "inputSatoshis": 499989200000000,
      "outputs": [{
        "satoshis": 499988200000000,
        "address": "THsh9NCUJi28K6ehi4HuV1UwF3CkQ2LfiqhsrcqjT4RFT",
      }, {
        "satoshis": 1000000000,
        "address": "TGEnkqNT2xxJKiPr3PJhhoWGu9pxeE3J2dorrk5Ph8UxU",
      }],
      "outputSatoshis": 499989200000000,
      "feeSatoshis": 0
    }, {
      "hash": "f86d3b14d3717edaf23d61a946cc2280525bc407917c47bb438aa0e622c77937",
      "inputs": [{
        "outputIndex": 1,
        "address": "TKvrqX3h5gQZ3JbwqToXdSngiHXw84tbnPAKqJeDWBHpe",
        "satoshis": 500000000000000
      }],
      "inputSatoshis": 500000000000000,
      "outputs": [{
        "satoshis": 5000000000,

        "address": "TGEnkqNT2xxJKiPr3PJhhoWGu9pxeE3J2dorrk5Ph8UxU",
      }, {
        "satoshis": 499995000000000,
        "address": "THQhMaaZDi1569tDMgBCwNddFXuDxN9PE4aBN8WZotN3y",
      }],
      "outputSatoshis": 500000000000000,
      "feeSatoshis": 0
    }];

    const addressToLookUp = 'TGEnkqNT2xxJKiPr3PJhhoWGu9pxeE3J2dorrk5Ph8UxU';
    const response = addressHandler.summarizeTxBalance(transactions, [ addressToLookUp ]);

    expect(response.balance).to.equal(2800000000);
    expect(response.received).to.equal(7800000000);
    expect(response.received - response.balance).to.equal(5000000000);
  });
});