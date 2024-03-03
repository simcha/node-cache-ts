import { EventEmitter } from "events";

/**
 * Key-validation: The keys can be given as either string or number,
 * but are casted to a string internally anyway.
 */
export type Key = string | number;

type Data<VT> = {
  [keyof: Key]: WrappedValue<VT>;
};

type WrappedValue<VT> = {
  t: number;
  v: VT | string;
};
export type Options = {
  /**
   * If enabled, all values will be stringified during the set operation
   *
   * @type {boolean}
   * @memberof Options
   */
  forceString?: boolean;

  /**
   * used standard size for calculating value size of object
   */
  objectValueSize?: number;

  /**
   * used standard size for calculating value size of promise
   */
  promiseValueSize?: number;

  /**
   * used standard size for calculating value size of array
   */
  arrayValueSize?: number;

  /**
   * standard time to live in seconds. 0 = infinity
   *
   * @type {number}
   * @memberof Options
   */
  stdTTL?: number;

  /**
   * time in seconds to check all data and delete expired keys
   *
   * @type {number}
   * @memberof Options
   */
  checkperiod?: number;

  /**
   * en/disable cloning of variables.
   * disabling this is strongly encouraged when aiming for performance!
   *
   * If `true`: set operations store a clone of the value and get operations will create a fresh clone of the cached value
   * If `false` you'll just store a reference to your value
   *
   * @type {boolean}
   * @memberof Options
   */
  useClones?: boolean;

  /**
   * whether values should be deleted automatically at expiration
   *
   * @type {boolean}
   */
  deleteOnExpire?: boolean;

  /**
   * max amount of keys that are being stored.
   * set operations will throw an error when the cache is full
   *
   * @type {number}
   * @memberof Options
   */
  maxKeys?: number;
};

export default class NodeCache<VT> extends EventEmitter {
  options: Required<Options>;
  data: Data<VT> = {};
  stats: {
    hits: number;
    misses: number;
    keys: number;
    ksize: number;
    vsize: number;
  };
  validKeyTypes = ["string", "number"];
  checkTimeout: NodeJS.Timeout | null = null;

  constructor(options: Options = {}) {
    super();
    this.options = {
      forceString: false,
      objectValueSize: 80,
      promiseValueSize: 80,
      arrayValueSize: 40,
      stdTTL: 0,
      //fix
      checkperiod: 60,
      useClones: true,
      deleteOnExpire: true,
      maxKeys: -1,
      ...options,
    };

    // statistics container
    this.stats = {
      hits: 0,
      misses: 0,
      keys: 0,
      ksize: 0,
      vsize: 0,
    };

    // initalize checking period
    this._checkData();
  }

  // ## get
  //
  // get a cached key and change the stats
  //
  // **Parameters:**
  //
  // * `key` ( String | Number ): cache key
  //
  // **Example:**
  //
  //	myCache.get "myKey", ( err, val )
  //
  get(key: Key): VT | string | undefined {
    // handle invalid key types
    let err = this._isInvalidKey(key);
    if (err) {
      throw err;
    }

    const value = this.data[key];
    // get data and increment stats
    if (value && this._check(key, value)) {
      this.stats.hits++;
      const _ret = this._unwrap(value);
      // return data
      return _ret;
    } else {
      // if not found return undefined
      this.stats.misses++;
      return undefined;
    }
  }

  // ## mget
  //
  // get multiple cached keys at once and change the stats
  //
  // **Parameters:**
  //
  // * `keys` ( String|Number[] ): an array of keys
  //
  // **Example:**
  //
  //	myCache.mget [ "foo", "bar" ]
  //
  mget(keys: Key[]) {
    // convert a string to an array of one key
    if (!Array.isArray(keys)) {
      const _err = this._error(
        "EKEYSTYPE",
        "The keys argument has to be an array.",
      );
      throw _err;
    }

    // define return
    const oRet: { [keyof: Key]: VT | string } = {};
    for (let key of keys) {
      // handle invalid key types
      let err = this._isInvalidKey(key);
      if (err) {
        throw err;
      }

      // get data and increment stats
      const value = this.data[key];
      if (value && this._check(key, value)) {
        this.stats.hits++;
        oRet[key] = this._unwrap(value);
      } else {
        // if not found return a error
        this.stats.misses++;
      }
    }

    // return all found keys
    return oRet;
  }

  // ## set
  //
  // set a cached key and change the stats
  //
  // **Parameters:**
  //
  // * `key` ( String | Number ): cache key
  // * `value` ( Any ): An element to cache. If the option `option.forceString` is `true` the module trys to translate it to a serialized JSON
  // * `[ ttl ]` ( Number | String ): ( optional ) The time to live in seconds.
  //
  // **Example:**
  //
  //	myCache.set "myKey", "my_String Value"
  //
  //	myCache.set "myKey", "my_String Value", 10
  //
  set(key: Key, value: VT, ttl = this.options.stdTTL) {
    // check if cache is overflowing
    let err = this._isInvalidKey(key);
    if (this.options.maxKeys > -1 && this.stats.keys >= this.options.maxKeys) {
      const _err = this._error("ECACHEFULL", "Cache max keys amount exceeded");
      throw _err;
    }

    //force the data to string
    let normalizedValue: string | VT = value;
    if (this.options.forceString && typeof value !== "string") {
      normalizedValue = JSON.stringify(value);
    }

    // handle invalid key types
    if (err) {
      throw err;
    }

    // internal helper variables
    let existent = false;

    const oldValue = this.data[key];
    // remove existing data from stats
    if (oldValue) {
      existent = true;
      this.stats.vsize -= this._getValLength(this._unwrap(oldValue, false));
    }

    // set the value
    this.data[key] = this._wrap(normalizedValue, ttl);
    this.stats.vsize += this._getValLength(normalizedValue);

    // only add the keys and key-size if the key is new
    if (!existent) {
      this.stats.ksize += this._getKeyLength(key);
      this.stats.keys++;
    }

    this.emit("set", key, normalizedValue);

    // return true
    return true;
  }
  // ## fetch
  //
  // in the event of a cache miss (no value is assinged to given cache key), value will be written to cache and returned. In case of cache hit, cached value will be returned without executing given value. If the given value is type of `Function`, it will be executed and returned result will be fetched
  //
  // **Parameters:**
  //
  // * `key` ( String | Number ): cache key
  // * `value` ( Any ): if `Function` type is given, it will be executed and returned value will be fetched, otherwise the value itself is fetched
  // * `[ ttl ]` ( Number | String ): ( optional ) The time to live in seconds.
  //
  // **Example:**
  //
  // myCache.fetch "myKey", 10, () => "my_String value"
  //
  // myCache.fetch "myKey", "my_String value"
  //
  fetch(key: Key, value: VT | (() => VT), ttl: number | string | undefined) {
    // check if cache is hit
    if (this.has(key)) {
      return this.get(key);
    }

    const _ret = value instanceof Function ? value() : value;
    this.set(key, _ret, Number(ttl));
    return _ret;
  }

  // ## mset
  //
  // set multiple keys at once
  //
  // **Parameters:**
  //
  // * `keyValueSet` ( Object[] ): an array of objects which include key, value, and ttl
  //
  // **Example:**
  //
  //	myCache.mset(
  //		[
  //			{
  //				key: "myKey",
  //				val: "myValue",
  //				ttl: [ttl in seconds]
  //			}
  //		])
  //
  //

  mset(keyValueSet: { key: number | string; val: VT; ttl: number }[]) {
    // check if cache is overflowing
    let _err: Error,
      key: number | string,
      keyValuePair: { key: number | string; val: VT; ttl: number },
      ttl: number,
      val: VT;
    if (
      this.options.maxKeys > -1 &&
      this.stats.keys + keyValueSet.length >= this.options.maxKeys
    ) {
      _err = this._error("ECACHEFULL", "Cache max keys amount exceeded");
      throw _err;
    }

    // loop over keyValueSet to validate key and ttl

    for (keyValuePair of keyValueSet) {
      ({ key, val, ttl } = keyValuePair);

      // check if there is ttl and it's a number
      if (ttl && typeof ttl !== "number") {
        _err = this._error("ETTLTYPE", "The ttl argument has to be a number.");
        throw _err;
      }

      // handle invalid key types
      let err = this._isInvalidKey(key);
      if (err) {
        throw err;
      }
    }

    for (keyValuePair of Array.from(keyValueSet)) {
      ({ key, val, ttl } = keyValuePair);
      this.set(key, val, ttl);
    }
    return true;
  }

  // ## del
  //
  // remove keys
  //
  // **Parameters:**
  //
  // * `keys` ( String | Number | String|Number[] ): cache key to delete or an array of cache keys
  //
  // **Return**
  //
  // ( Number ): Number of deleted keys
  //
  // **Example:**
  //
  //	myCache.del( "myKey" )
  //
  del(keys: Key | Key[]) {
    // convert keys to an array of itself
    let keysArr: Key[];
    if (Array.isArray(keys)) {
      keysArr = keys;
    } else {
      keysArr = [keys];
    }

    let delCount = 0;
    for (let key of keysArr) {
      // handle invalid key types
      var err = this._isInvalidKey(key);
      if (err) {
        throw err;
      }
      const dataValue = this.data[key];
      // only delete if existent
      if (dataValue) {
        // calc the stats
        this.stats.vsize -= this._getValLength(this._unwrap(dataValue, false));
        this.stats.ksize -= this._getKeyLength(key);
        this.stats.keys--;
        delCount++;
        // delete the value
        const oldVal = this.data[key];
        delete this.data[key];
        // return true
        this.emit("del", key, oldVal?.v);
      }
    }

    return delCount;
  }

  // ## take
  //
  // get the cached value and remove the key from the cache.
  // Equivalent to calling `get(key)` + `del(key)`.
  // Useful for implementing `single use` mechanism such as OTP, where once a value is read it will become obsolete.
  //
  // **Parameters:**
  //
  // * `key` ( String | Number ): cache key
  //
  // **Example:**
  //
  //	myCache.take "myKey", ( err, val )
  //
  take(key: Key) {
    const _ret = this.get(key);
    if (_ret !== null) {
      this.del(key);
    }
    return _ret;
  }

  // ## ttl
  //
  // reset or redefine the ttl of a key. `ttl` = 0 means infinite lifetime.
  // If `ttl` is not passed the default ttl is used.
  // If `ttl` < 0 the key will be deleted.
  //
  // **Parameters:**
  //
  // * `key` ( String | Number ): cache key to reset the ttl value
  // * `ttl` ( Number ): ( optional -> options.stdTTL || 0 ) The time to live in seconds
  //
  // **Return**
  //
  // ( Boolen ): key found and ttl set
  //
  // **Example:**
  //
  //	myCache.ttl( "myKey" ) // will set ttl to default ttl
  //
  //	myCache.ttl( "myKey", 1000 )
  //
  ttl(key: Key, ttl: number) {
    let err = this._isInvalidKey(key);
    if (!ttl) {
      ttl = this.options.stdTTL;
    }
    if (!key) {
      return false;
    }

    // handle invalid key types
    if (err) {
      throw err;
    }

    const dataValue = this.data[key];
    // check for existent data and update the ttl value
    if (dataValue && this._check(key, dataValue)) {
      // if ttl < 0 delete the key. otherwise reset the value
      if (ttl >= 0) {
        this.data[key] = this._wrap(dataValue.v, ttl, false);
      } else {
        this.del(key);
      }
      return true;
    } else {
      // return false if key has not been found
      return false;
    }
  }

  // ## getTtl
  //
  // receive the ttl of a key.
  //
  // **Parameters:**
  //
  // * `key` ( String | Number ): cache key to check the ttl value of
  //
  // **Return**
  //
  // ( Number|undefined ): The timestamp in ms when the key will expire, 0 if it will never expire or undefined if it not exists
  //
  // **Example:**
  //
  //	myCache.getTtl( "myKey" )
  //
  getTtl(key: Key) {
    let err = this._isInvalidKey(key);
    if (!key) {
      return undefined;
    }

    // handle invalid key types
    if (err) {
      throw err;
    }

    // check for existant data and update the ttl value
    if (this.data[key] && this._check(key, this.data[key])) {
      const _ttl = this.data[key]?.t;
      return _ttl;
    } else {
      // return undefined if key has not been found
      return undefined;
    }
  }

  // ## keys
  //
  // list all keys within this cache
  //
  // **Return**
  //
  // ( Array ): An array of all keys
  //
  // **Example:**
  //
  //     _keys = myCache.keys()
  //
  //     # [ "foo", "bar", "fizz", "buzz", "anotherKeys" ]
  //
  keys() {
    const _keys = Object.keys(this.data);
    return _keys;
  }

  // ## has
  //
  // Check if a key is cached
  //
  // **Parameters:**
  //
  // * `key` ( String | Number ): cache key to check the ttl value
  //
  // **Return**
  //
  // ( Boolean ): A boolean that indicates if the key is cached
  //
  // **Example:**
  //
  //     _exists = myCache.has('myKey')
  //
  //     # true
  //
  has(key: Key) {
    const _exists = !!this.data[key] && this._check(key, this.data[key]);
    return _exists;
  }

  // ## getStats
  //
  // get the stats
  //
  // **Parameters:**
  //
  // -
  //
  // **Return**
  //
  // ( Object ): Stats data
  //
  // **Example:**
  //
  //     myCache.getStats()
  //     # {
  //     # hits: 0,
  //     # misses: 0,
  //     # keys: 0,
  //     # ksize: 0,
  //     # vsize: 0
  //     # }
  //
  getStats() {
    return this.stats;
  }

  // ## flushAll
  //
  // flush the whole data and reset the stats
  //
  // **Example:**
  //
  //     myCache.flushAll()
  //
  //     myCache.getStats()
  //     # {
  //     # hits: 0,
  //     # misses: 0,
  //     # keys: 0,
  //     # ksize: 0,
  //     # vsize: 0
  //     # }
  //
  flushAll(_startPeriod: boolean = true) {
    // parameter just for testing

    // set data empty
    this.data = {};

    // reset stats
    this.stats = {
      hits: 0,
      misses: 0,
      keys: 0,
      ksize: 0,
      vsize: 0,
    };

    // reset check period
    this._killCheckPeriod();
    this._checkData(_startPeriod);

    this.emit("flush");
  }

  // ## flushStats
  //
  // flush the stats and reset all counters to 0
  //
  // **Example:**
  //
  //     myCache.flushStats()
  //
  //     myCache.getStats()
  //     # {
  //     # hits: 0,
  //     # misses: 0,
  //     # keys: 0,
  //     # ksize: 0,
  //     # vsize: 0
  //     # }
  //
  flushStats() {
    // reset stats
    this.stats = {
      hits: 0,
      misses: 0,
      keys: 0,
      ksize: 0,
      vsize: 0,
    };

    this.emit("flush_stats");
  }

  // ## close
  //
  // This will clear the interval timeout which is set on checkperiod option.
  //
  // **Example:**
  //
  //     myCache.close()
  //
  close() {
    this._killCheckPeriod();
  }

  // ## _checkData
  //
  // internal housekeeping method.
  // Check all the cached data and delete the invalid values
  async _checkData(startPeriod: boolean = true) {
    // run the housekeeping method
    for (let key in this.data) {
      const value = this.data[key];
      this._check(key, value);
    }
    if (startPeriod && this.options.checkperiod > 0) {
      this.checkTimeout = setTimeout(() => {
        this._checkData();
      }, this.options.checkperiod);
      // }, this.options.checkperiod * 1000);
      this.checkTimeout.unref();
    }
  }

  // ## _killCheckPeriod
  //
  // stop the checkdata period. Only needed to abort the script in testing mode.
  _killCheckPeriod() {
    if (this.checkTimeout !== null) {
      return clearTimeout(this.checkTimeout);
    }
  }

  // ## _check
  //
  // internal method the check the value. If it's not valid any more delete it
  _check(key: Key, data: WrappedValue<VT> | undefined) {
    let _retval = true;
    // data is invalid if the ttl is too old and is not 0
    if (data && data.t !== 0 && data.t < Date.now()) {
      if (this.options.deleteOnExpire) {
        _retval = false;
        this.del(key);
      }
      this.emit("expired", key, this._unwrap(data));
    }
    return _retval;
  }

  // ## _isInvalidKey
  //
  // internal method to check if the type of a key is either `number` or `string`
  _isInvalidKey(key: unknown) {
    if (!Array.from(this.validKeyTypes).includes(typeof key)) {
      return this._error(
        "EKEYTYPE",
        `The key argument has to be of type \`string\` or \`number\`. Found: \`${typeof key}\``,
      );
    }
  }

  // ## _wrap
  //
  // internal method to wrap a value in an object with some metadata
  _wrap(
    value: VT | string,
    ttl: number | string,
    asClone: boolean = true,
  ): WrappedValue<VT> {
    if (!this.options.useClones) {
      asClone = false;
    }
    // define the time to live
    const now = Date.now();
    let livetime = 0;

    const ttlMultiplicator = 1000;

    // use given ttl
    if (ttl === 0) {
      livetime = 0;
    } else if (ttl) {
      livetime = now + Number(ttl) * ttlMultiplicator;
    } else {
      // use standard ttl
      if (this.options.stdTTL === 0) {
        livetime = this.options.stdTTL;
      } else {
        livetime = now + this.options.stdTTL * ttlMultiplicator;
      }
    }

    // return the wrapped value
    return {
      t: livetime,
      v: asClone ? structuredClone(value) : value,
    };
  }

  // ## _unwrap
  //
  // internal method to extract get the value out of the wrapped value
  _unwrap(value: WrappedValue<VT>, asClone: boolean = true): VT | string {
    if (!this.options.useClones) {
      asClone = false;
    }
    if (asClone) {
      return structuredClone(value.v);
    } else {
      return value.v;
    }
  }

  // ## _getKeyLength
  //
  // internal method the calculate the key length
  _getKeyLength(key: number | string) {
    return key.toString().length;
  }

  // ## _getValLength
  //
  // internal method to calculate the value length
  // eslint-disable-next-line @typescript-eslint/ban-types
  _getValLength(value: VT | string) {
    if (typeof value === "string") {
      // if the value is a String get the real length
      return value.length;
    } else if (this.options.forceString) {
      // force string if it's defined and not passed
      return JSON.stringify(value).length;
    } else if (Array.isArray(value)) {
      // if the data is an Array multiply each element with a defined default length
      return this.options.arrayValueSize * value.length;
    } else if (typeof value === "number") {
      return 8;
    } else if (
      value &&
      typeof value === "object" &&
      typeof value.hasOwnProperty("then") === "function"
    ) {
      // if the data is a Promise, use defined default
      // (can't calculate actual/resolved value size synchronously)
      return this.options.promiseValueSize;
    } else if (typeof Buffer !== "undefined" && Buffer.isBuffer(value)) {
      return value.length;
    } else if (value && typeof value === "object") {
      // if the data is an Object multiply each element with a defined default length
      return this.options.objectValueSize * Object.keys(value).length;
    } else if (typeof value === "boolean") {
      return 8;
    } else {
      // default fallback
      return 0;
    }
  }

  // ## _error
  //
  // internal method to handle an error message
  _error(name: string, message = "") {
    const error = new Error();
    error.name = name;
    error.message = message;
    return error;
  }
}
