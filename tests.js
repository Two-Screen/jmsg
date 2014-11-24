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
