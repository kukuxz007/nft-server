const _ = require('lodash');
const minify = require('pg-minify');

const { convertKeysToCamelCase } = require('../utils/keyConversion');
const { pgp, connect } = require('../utils/dbConnection');

const db = 'nft';

// multi row insert (update on conflict) query generator
const buildCollectionQ = (payload) => {
  const columns = [
    'collectionId',
    'name',
    'slug',
    'image',
    'tokenStandard',
    'totalSupply',
    'projectUrl',
    'twitterUsername',
  ].map((c) => _.snakeCase(c));

  const cs = new pgp.helpers.ColumnSet(columns, { table: 'collection' });
  const query =
    pgp.helpers.insert(payload, cs) +
    ' ON CONFLICT(collection_id) DO UPDATE SET ' +
    cs.assignColumns({ from: 'EXCLUDED', skip: 'collection_id' });

  return query;
};

// multi row insert query generator
const buildFloorQ = (payload) => {
  const columns = [
    'collectionId',
    'timestamp',
    'onSaleCount',
    'floorPrice',
    'floorPrice1day',
    'floorPrice7day',
    'floorPrice30day',
    'rank',
  ].map((c) => _.snakeCase(c));

  const cs = new pgp.helpers.ColumnSet(columns, { table: 'floor' });
  return pgp.helpers.insert(payload, cs);
};

// --------- transaction query
const insertCollections = async (payload) => {
  const conn = await connect(db);

  // build queries
  const collectionQ = buildCollectionQ(payload);
  const floorQ = buildFloorQ(payload);

  return conn
    .tx(async (t) => {
      // sequence of queries:
      // 1. config: insert/update
      const q1 = await t.result(collectionQ);
      // 2. floor: insert
      const q2 = await t.result(floorQ);

      return [q1, q2];
    })
    .then((response) => {
      // success, COMMIT was executed
      return {
        status: 'success',
        data: response,
      };
    })
    .catch((err) => {
      // failure, ROLLBACK was executed
      console.log(err);
      return new Error('Transaction failed, rolling back', 404);
    });
};

const getCollection = async (collectionId) => {
  const conn = await connect(db);

  const query = minify(
    `
SELECT
    name,
    image,
    total_supply,
    token_standard,
    project_url,
    twitter_username
FROM
    collection
WHERE
    collection_id = $<collectionId>
    `
  );

  const response = await conn.query(query, {
    collectionId,
  });

  if (!response) {
    return new Error(`Couldn't get data`, 404);
  }

  return response.map((c) => convertKeysToCamelCase(c));
};

// get most recent data for all collections
const getCollections = async () => {
  const conn = await connect(db);

  const query = minify(
    `
WITH filtered_records AS (
    SELECT
        DISTINCT ON (collection_id) *
    FROM
        floor
    WHERE
        timestamp >= NOW() - INTERVAL '7 DAY'
    ORDER BY
        collection_id,
        timestamp DESC
)
SELECT
    f.collection_id,
    rank,
    timestamp,
    name,
    slug,
    image,
    token_standard,
    total_supply,
    project_url,
    twitter_username,
    on_sale_count,
    floor_price,
    floor_price_1_day,
    floor_price_7_day,
    floor_price_30_day,
    calculate_percent_change(floor_price, floor_price_1_day) as floor_price_pct_change_1_day,
    calculate_percent_change(floor_price, floor_price_7_day) as floor_price_pct_change_7_day,
    calculate_percent_change(floor_price, floor_price_30_day) as floor_price_pct_change_30_day
FROM
    filtered_records AS f
    INNER JOIN collection AS c ON c.collection_id = f.collection_id;
  `,
    { compress: true }
  );

  const response = await conn.query(query);

  if (!response) {
    return new Error(`Couldn't get data`, 404);
  }

  return response
    .map((c) => convertKeysToCamelCase(c))
    .filter((c) => c.rank > 0 || c.rank === null)
    .sort((a, b) => (a.rank ?? Infinity) - (b.rank ?? Infinity));
};

const getFloorHistory = async (collectionId) => {
  const conn = await connect(db);

  const query = minify(
    `
SELECT
    timestamp,
    floor_price
FROM
    floor
WHERE
    timestamp IN (
        SELECT
            max(timestamp)
        FROM
            floor
        WHERE
            collection_id = $<collectionId>
        GROUP BY
            (timestamp :: date)
    )
    AND collection_id = $<collectionId>
ORDER BY
    timestamp ASC
  `,
    { compress: true }
  );

  const response = await conn.query(query, {
    collectionId,
  });

  if (!response) {
    return new Error(`Couldn't get data`, 404);
  }

  return response.map((c) => convertKeysToCamelCase(c));
};

module.exports = {
  insertCollections,
  getCollections,
  getCollection,
  getFloorHistory,
};
