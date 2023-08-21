const abi = require('../../trades/manifold/abi.json');
const config = require('./config.json');

const nullAddress = '0000000000000000000000000000000000000000';

const parse = (decodedData, event) => {
  const eventType = config.events.find(
    (e) => e.signatureHash === `0x${event.topic_0}`
  )?.name;

  if (eventType === 'BidEvent') {
    const { listingId, bidder, amount } = decodedData;

    const price = amount.toString() / 1e18;
    return {
      eventId: listingId,
      price,
      ethPrice: price,
      usdPrice: price * event.price,
      userAddress: bidder,
      currencyAddress: nullAddress,
      eventType,
    };
  } else if (eventType === 'CancelListing') {
    const { listingId, requestor } = decodedData;

    return {
      eventType,
      eventId: listingId,
      userAddress: requestor,
    };
  }
};

module.exports = { abi, config, parse };