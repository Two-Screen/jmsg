'use strict';

class Jmsg {
    constructor(writeFn, handlers) {
        this.handlers = handlers || {};
        this.timeout = 60000;

        this._callbacks = [];
        this._writeFn = writeFn;
    }

    // Remove undefineds off the end of the callback list.
    _trimCallbacks() {
        const callbacks = this._callbacks;
        let i = callbacks.length - 1;
        while (i >= 0 && callbacks[i] === undefined)
            i--;
        callbacks.length = i + 1;
    }

    // Send a JSON message.
    send(a, b, c, d) {
        if (!this._writeFn)
            exports.dummySend(a, b, c, d);
        // type, value, [cb], [handle]
        else if (typeof(b) !== 'function')
            this._sendRaw({ t: a, v: b }, c, d);
        // type, [cb], [handle]
        else
            this._sendRaw({ t: a }, b, d);
    }

    _sendRaw(msg, cb, handle) {
        if (typeof(cb) === 'function') {
            const handlers = this._handlers;
            const callbacks = this._callbacks;

            let seq = 0;
            while (callbacks[seq])
                seq++;
            msg.s = seq;

            callbacks[seq] = {
                fn: cb,
                timeout: setTimeout(() => {
                    callbacks[seq] = undefined;
                    this._trimCallbacks();
                    cb.call(handlers, Error("Timeout"),
                        null, exports.noReplyCallback);
                }, this.timeout)
            };
        }
        this._writeFn(msg, handle);
    }

    // Dispatch a JSON message.
    dispatch(msg, handle) {
        const seq = msg.s;
        const callback = seq !== undefined ? (err, val, cb, handle) => {
            this._sendRaw({
                r: seq,
                e: errorSerializer(err),
                v: val
            }, cb, handle);
        } : exports.noReplyCallback;

        let fn, tmp;
        const handlers = this.handlers;
        if ((tmp = msg.r) !== undefined) {
            const callbacks = this._callbacks;
            fn = callbacks[tmp];
            if (fn) {
                callbacks[tmp] = undefined;
                clearTimeout(fn.timeout);
                this._trimCallbacks();
                fn.fn.call(handlers, msg.e, msg.v, callback, handle);
            }
            else if (seq !== undefined) {
                callback(Error("Unknown sequence number"));
            }
        }
        else if ((tmp = msg.t) !== undefined) {
            fn = handlers.hasOwnProperty(tmp) && handlers[tmp];
            if (fn)
                fn.call(handlers, msg.v, callback, handle);
            else if (seq !== undefined)
                callback(Error("No such action"));
        }
    }

    // Close the instance, finishing all callbacks.
    close(err) {
        if (!err)
            err = Error("Connection closed");
        const handlers = this._handlers;
        const callbacks = this._callbacks.slice(0);
        this._callbacks.length = 0;
        this._writeFn = null;
        callbacks.forEach((fn) => {
            clearTimeout(fn.timeout);
            fn.fn.call(handlers, err, null, exports.noReplyCallback, null);
        });
    }
}

// Main export.
exports = module.exports = (writeFn, handlers) => {
    return new Jmsg(writeFn, handlers);
};

// Process on a pair of readable and writable streams.
exports.streams = (readable, writable, handlers) => {
    const handle = exports((msg) => {
        writable.write(JSON.stringify(msg) + "\n");
    }, handlers);

    const carry = require('carrier').carry(readable);

    carry.on('line', (msg) => {
        try { msg = JSON.parse(msg); }
        catch (err) { /* ignore */ }

        if (typeof(msg) === 'object' && msg !== null)
            handle.dispatch(msg);
    });

    carry.on('end', () => {
        handle.close();
    });

    return handle;
};

// Process on a duplex stream.
exports.stream = (stream, handlers) => {
    return exports.streams(stream, stream, handlers);
};

// Process cluster messages.
exports.cluster = (a, b) => {
    let channel, handlers;
    // worker, [handlers]
    if (process.send) {
        channel = process;
        handlers = a;
    }
    // [handlers]
    else {
        channel = a;
        handlers = b;
    }

    const handle = exports(channel.send.bind(channel), handlers);

    channel.on('message', handle.dispatch.bind(handle));

    channel.on('exit', () => {
        handle.close();
    });

    return handle;
};

// The callback function passed to handlers when the other side doesn't
// expect a reply to the message.
exports.noReplyCallback = (err, obj, cb) => {
    if (cb)
        cb(Error("No reply expected"), null, exports.noReplyCallback);
};

// A dummy send function used when the connection is down. Events are silently
// dropped, and actions immediately error.
exports.dummySend = (a, b, c) => {
    const cb = c || b;
    if (typeof(cb) === 'function')
        cb(Error("Connection closed"), null, exports.noReplyCallback);
};

// Error serialization matching bunyan. (Both MIT)
// https://github.com/trentm/node-bunyan/blob/e43a1a405f379c37d59c4227168dca0e8f41d052/lib/bunyan.js#L968-L1002
const getFullErrorStack = (ex) => {
    let ret = ex.stack || ex.toString();
    if (typeof(ex.cause) === 'function') {
        const cex = ex.cause();
        if (cex)
            ret += '\nCaused by: ' + getFullErrorStack(cex);
    }
    return ret;
};

const errorSerializer = (v) => {
    if (v && v.stack) {
        v = {
            message: v.message,
            name: v.name,
            stack: getFullErrorStack(v),
            code: v.code,
            signal: v.signal
        };
    }
    return v;
};
