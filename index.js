function Jmsg(writeFn, handlers) {
    this.handlers = handlers || {};
    this.timeout = 60000;

    this._seq = 1;
    this._callbacks = Object.create(null);
    this._writeFn = writeFn;
}

// Send a JSON message.
Jmsg.prototype.send = function(a, b, c, d) {
    // type, value, [cb], [handle]
    if (typeof(b) !== 'function')
        this._sendRaw({ t: a, v: b }, c, d);
    // type, [cb], [handle]
    else
        this._sendRaw({ t: a }, b, d);
};

Jmsg.prototype._sendRaw = function(msg, cb, handle) {
    if (typeof(cb) === 'function') {
        var handlers = this._handlers;
        var callbacks = this._callbacks;
        var seq = msg.s = this._seq++;
        callbacks[seq] = {
            fn: cb,
            timeout: setTimeout(function() {
                delete callbacks[seq];
                cb.call(handlers, new Error("Timeout"), null, noReplyCallback);
            }, this.timeout)
        };
    }
    this._writeFn(msg, handle);
};

// Dispatch a JSON message.
Jmsg.prototype.dispatch = function(msg, handle) {
    var self = this;

    var seq = msg.s;
    var callback = seq ? function(err, val, cb, handle) {
        self._sendRaw({ r: seq, e: errorSerializer(err), v: val }, cb, handle);
    } : noReplyCallback;

    var fn, tmp;
    var handlers = self.handlers;
    if ((tmp = msg.r)) {
        var callbacks = self._callbacks;
        fn = callbacks[tmp];
        if (fn) {
            delete callbacks[tmp];
            clearTimeout(fn.timeout);
            fn.fn.call(handlers, msg.e, msg.v, callback, handle);
        }
        else if (seq) {
            callback(new Error("Unknown sequence number"));
        }
    }
    else if ((tmp = msg.t)) {
        fn = handlers.hasOwnProperty(tmp) && handlers[tmp];
        if (fn)
            fn.call(handlers, msg.v, callback, handle);
        else if (seq)
            callback(new Error("No such action"));
    }
};

// Close the instance, finishing all callbacks.
Jmsg.prototype.close = function(err) {
    var handlers = this._handlers;
    var callbacks = this._callbacks;
    this._callbacks = Object.create(null);
    Object.keys(callbacks).forEach(function(key) {
        if (!err) err = new Error("Connection closed");
        callbacks[key].fn.call(handlers, err, null, noReplyCallback, null);
    });
};


// Main export.
exports = module.exports = function(writeFn, handlers) {
    return new Jmsg(writeFn, handlers);
};

// Process on a duplex stream.
exports.stream = function(stream, handlers) {
    var handle = exports(function(msg) {
        stream.write(JSON.stringify(msg) + "\n");
    }, handlers);

    var carry = require('carrier').carry(stream);

    carry.on('line', function(msg) {
        try { msg = JSON.parse(msg); }
        catch (err) {}

        if (typeof(msg) === 'object' && msg !== null)
            handle.dispatch(msg);
    });

    carry.on('end', function() {
        handle.close();
    });

    return handle;
};

// Process cluster messages.
exports.cluster = function(a, b) {
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

    var handle = exports(channel.send.bind(channel), handlers);

    channel.on('message', handle.dispatch.bind(handle));

    channel.on('exit', function() {
        handle.close();
    });

    return handle;
};


// The callback function passed to handlers when the other side doesn't
// expect a reply to the message.
var noReplyCallback = function(err, obj, cb) {
    if (cb)
        cb(new Error("No reply expected"), null, noReplyCallback);
};

// Error serialization matching bunyan. (Both MIT)
// https://github.com/trentm/node-bunyan/blob/e43a1a405f379c37d59c4227168dca0e8f41d052/lib/bunyan.js#L968-L1002
var getFullErrorStack = function(ex) {
    var ret = ex.stack || ex.toString();
    if (typeof(ex.cause) === 'function') {
        var cex = ex.cause();
        if (cex)
            ret += '\nCaused by: ' + getFullErrorStack(cex);
    }
    return ret;
};

var errorSerializer = function(v) {
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
