import { Serializable } from 'child_process';
import NodeCache, { Options, Key } from './node_cache';

export type RefreshOptions = Options & {
    /** Time to refresh in seconds. If not prowided: 70% of defaultTTL if defaultTTL = 0 ttr = 10 minutes. */
    ttr?: number;
    /** To refresh again till ttl. */
    retryOnError?: boolean;
    /** Pause between retry on error. */
    retryPause?: number;
    /** Will store clones of arguments. */
    argsUseClones?: boolean;
}

/**
 * A are the arguments to the refreshMethod method refreshing keys
 * T is a type of the value to be cached
 */
export class SnowCache<A extends {[key: string]: Serializable}, T> extends NodeCache<T> {
    refreshMethod: (args: A) => Promise<T>;
    private _refreshArgsCache: NodeCache<A>;
    private _runningCalls: {[key: string]: Promise<T>} = {};
    ttr: number;
    retryPause: number;
    ttrAsFractionOfTTL = 0.7;
    //default ttr if no 
    defaultTTR = 600;
    refreshOptions: RefreshOptions = {};

    constructor(options: RefreshOptions = {}, refreshMethod: (args: A) => Promise<T> ) {
        super(options);
        this.refreshOptions = options;
        this.ttr = options.ttr || (options.stdTTL ? (options.stdTTL * this.ttrAsFractionOfTTL) : this.defaultTTR);
        // if error ocured wait given time or halve of time to refresh before next refresh
        this.retryPause = options.retryPause || Math.ceil(this.ttr/5);

        this._refreshArgsCache = new NodeCache<A>({stdTTL: this.ttr, checkperiod: options.checkperiod, useClones: this.refreshOptions.argsUseClones}).on( 'expired', ( key, value ) => {
            this.refreshEntry(key, value);
        });
        this.refreshMethod = refreshMethod;
    }

    public async call(key: Key, args: A): Promise<T> {
        let response:T;
        if (super.has(key)){
            response = super.get(key) as T;
        } else {
            const waitingCall = this._runningCalls[key];
            if(waitingCall){
                response = await waitingCall;
            } else {
                try {
                    const promise = this.refreshMethod(args);
                    this._runningCalls[key] = promise;
                    response = await promise;
                    super.set(key, response);
                } finally {
                    delete this._runningCalls[key];
                }
            }
        }
        // if no refresh sheduled schedule one
        if (!this._refreshArgsCache.has(key)) {
            this._refreshArgsCache.set(key, args);
        } 
        return await Promise.resolve(response);
    }
    
    public flushAll(){
        super.flushAll();
        this._refreshArgsCache.flushAll();
    }

    public del(keys: Key | Key[]): number{
        this._refreshArgsCache.del(keys);
        return super.del(keys);
    }

    private async refreshEntry(key: string, args: A) {
        try {
            const response = await this.refreshMethod(args);
            super.set(key, response);
        } catch (error) {
            const ttl = super.getTtl(key);
            if (ttl && this.retryPause*1000 < ttl) {
                this._refreshArgsCache.set(key, args, this.retryPause);
            } 
            this.emit('refresh_error', error, key, args);
        }
    }
}

