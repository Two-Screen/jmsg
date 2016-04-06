'use strict';

const net = require('net');
const zlib = require('zlib');
const test = require('tap').test;
const jmsg = require('./');

const createPair = () => {
    const left = jmsg((obj) => {
        right.dispatch(obj);
    });

    const right = jmsg((obj) => {
        left.dispatch(obj);
    });

    left.timeout = right.timeout = 100;

    return { left: left, right: right };
};

test('action / reply', { timeout: 500 }, (t) => {
    t.plan(5);

    const pair = createPair();

    pair.right.handlers.beep = (num, cb) => {
        t.pass('Right side received action');
        cb(null, num + 1, rightReplyCb);
    };

    const leftReplyCb = (err, num, cb) => {
        t.ok(!err, 'Left side received reply ' + num);
        cb(null, num + 1, num < 3 && leftReplyCb);
    };

    const rightReplyCb = (err, num, cb) => {
        t.ok(!err, 'Right side received reply ' + num);
        cb(null, num + 1, num < 4 && rightReplyCb);
    };

    pair.left.send('beep', 0, leftReplyCb);
});

test('event', { timeout: 500 }, (t) => {
    t.plan(2);
    const pair = createPair();

    pair.right.handlers.beep = (err) => {
        t.ok(!err, 'Received event');
    };
    pair.left.send('beep', (err) => {
        t.is(err.message, 'Timeout', 'Event reply should time out');
    });
});

test('bad action / reply', { timeout: 500 }, (t) => {
    t.plan(3);
    const pair = createPair();

    pair.left.send('beep', (err) => {
        t.is(err.message, 'No such action',
            'Non-existant action should error');
    });

    pair.right.handlers.beep = (val, cb) => {
        t.pass('Received action');
        cb(null, null, (err) => {
            t.is(err.message, 'No reply expected',
                'Reply to event should error');
        });
    };
    pair.left.send('beep');
});

test('close', { timeout: 500 }, (t) => {
    t.plan(5);
    const pair = createPair();

    // This is here to check for double callbacks.
    pair.right.handlers.good = (arg, cb) => {
        t.pass('Received good action');
        cb();
    };
    pair.left.send('good', (err) => {
        t.ok(!err, 'Received good reply');
    });

    pair.right.handlers.bad = () => {
        t.pass('Received bad action');
    };
    pair.left.send('bad', (err) => {
        t.is(err.message, 'Connection closed',
            'Open callback receives error on close');
    });

    pair.left.close();

    pair.left.send('good', (err) => {
        t.is(err.message, 'Connection closed',
            'Callback receives error after close');
    });
});


const createSocketPair = (t, cb) => {
    let right;
    const server = net.createServer((left) => {
        t.on('end', () => {
            left.destroy();
        });
        cb(left, right);
    });
    t.on('end', () => {
        server.close();
    });
    server.listen(0, () => {
        right = net.connect(server.address().port);
        t.on('end', () => {
            right.destroy();
        });
    });
};

test('duplex streams', { timeout: 500 }, (t) => {
    t.plan(2);

    createSocketPair(t, (leftSocket, rightSocket) => {
        const left = jmsg.stream(leftSocket);
        const right = jmsg.stream(rightSocket);
        left.timeout = right.timeout = 100;

        right.handlers.beep = (arg, cb) => {
            t.pass('Right side received action');
            cb();
        };
        left.send('beep', (err) => {
            t.ok(!err, 'Left side received reply');
        });
    });
});

test('read/write streams', { timeout: 500 }, (t) => {
    t.plan(2);

    createSocketPair(t, (leftSocket, rightSocket) => {
        const leftWrite = zlib.createGzip({ flush: zlib.Z_SYNC_FLUSH });
        const leftRead = zlib.createGunzip();
        leftWrite.pipe(leftSocket);
        leftSocket.pipe(leftRead);

        const rightWrite = zlib.createGzip({ flush: zlib.Z_SYNC_FLUSH });
        const rightRead = zlib.createGunzip();
        rightWrite.pipe(rightSocket);
        rightSocket.pipe(rightRead);

        const left = jmsg.streams(leftRead, leftWrite);
        const right = jmsg.streams(rightRead, rightWrite);
        left.timeout = right.timeout = 100;

        right.handlers.beep = (arg, cb) => {
            t.pass('Right side received action');
            cb();
        };
        left.send('beep', (err) => {
            t.ok(!err, 'Left side received reply');
        });
    });
});
