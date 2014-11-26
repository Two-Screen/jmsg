var net = require('net');
var zlib = require('zlib');
var test = require('tap').test;
var jmsg = require('./');

function createPair() {
    var left = jmsg(function(obj) {
        right.dispatch(obj);
    });

    var right = jmsg(function(obj) {
        left.dispatch(obj);
    });

    left.timeout = right.timeout = 100;

    return { left: left, right: right };
}

test('action / reply', { timeout: 500 }, function(t) {
    t.plan(5);

    var pair = createPair();

    pair.right.handlers.beep = function(num, cb) {
        t.pass('Right side received action');
        cb(null, num + 1, rightReplyCb);
    };

    function leftReplyCb(err, num, cb) {
        t.ok(!err, 'Left side received reply ' + num);
        cb(null, num + 1, num < 3 && leftReplyCb);
    }

    function rightReplyCb(err, num, cb) {
        t.ok(!err, 'Right side received reply ' + num);
        cb(null, num + 1, num < 4 && rightReplyCb);
    }

    pair.left.send('beep', 0, leftReplyCb);
});

test('event', { timeout: 500 }, function(t) {
    t.plan(2);
    var pair = createPair();

    pair.right.handlers.beep = function(err) {
        t.ok(!err, 'Received event');
    };
    pair.left.send('beep', function(err) {
        t.is(err.message, 'Timeout', 'Event reply should time out');
    });
});

test('bad action / reply', { timeout: 500 }, function(t) {
    t.plan(3);
    var pair = createPair();

    pair.left.send('beep', function(err) {
        t.is(err.message, 'No such action',
            'Non-existant action should error');
    });

    pair.right.handlers.beep = function(val, cb) {
        t.pass('Received action');
        cb(null, null, function(err) {
            t.is(err.message, 'No reply expected',
                'Reply to event should error');
        });
    };
    pair.left.send('beep');
});

test('close', { timeout: 500 }, function(t) {
    t.plan(5);
    var pair = createPair();

    // This is here to check for double callbacks.
    pair.right.handlers.good = function(arg, cb) {
        t.pass('Received good action');
        cb();
    };
    pair.left.send('good', function(err) {
        t.ok(!err, 'Received good reply');
    });

    pair.right.handlers.bad = function(arg, cb) {
        t.pass('Received bad action');
    };
    pair.left.send('bad', function(err) {
        t.is(err.message, 'Connection closed',
            'Open callback receives error on close');
    });

    pair.left.close();

    pair.left.send('good', function(err) {
        t.is(err.message, 'Connection closed',
            'Callback receives error after close');
    });
});


function createSocketPair(t, cb) {
    var right;
    var server = net.createServer(function(left) {
        t.on('end', function() {
            left.destroy();
        });
        cb(left, right);
    });
    t.on('end', function() {
        server.close();
    });
    server.listen(0, function() {
        right = net.connect(server.address().port);
        t.on('end', function() {
            right.destroy();
        });
    });
}

test('duplex streams', { timeout: 500 }, function(t) {
    t.plan(2);

    createSocketPair(t, function(leftSocket, rightSocket) {
        var left = jmsg.stream(leftSocket);
        var right = jmsg.stream(rightSocket);
        left.timeout = right.timeout = 100;

        right.handlers.beep = function(arg, cb) {
            t.pass('Right side received action');
            cb();
        };
        left.send('beep', function(err) {
            t.ok(!err, 'Left side received reply');
        });
    });
});

test('read/write streams', { timeout: 500 }, function(t) {
    t.plan(2);

    createSocketPair(t, function(leftSocket, rightSocket) {
        var leftWrite = zlib.createGzip({ flush: zlib.Z_SYNC_FLUSH });
        var leftRead = zlib.createGunzip();
        leftWrite.pipe(leftSocket);
        leftSocket.pipe(leftRead);

        var rightWrite = zlib.createGzip({ flush: zlib.Z_SYNC_FLUSH });
        var rightRead = zlib.createGunzip();
        rightWrite.pipe(rightSocket);
        rightSocket.pipe(rightRead);

        var left = jmsg.streams(leftRead, leftWrite);
        var right = jmsg.streams(rightRead, rightWrite);
        left.timeout = right.timeout = 100;

        right.handlers.beep = function(arg, cb) {
            t.pass('Right side received action');
            cb();
        };
        left.send('beep', function(err) {
            t.ok(!err, 'Left side received reply');
        });
    });
});
