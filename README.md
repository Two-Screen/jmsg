## jmsg

Jmsg is a simple module to communicate with another instance across a stream or
other kind of message channel. Communication is two-way, and messages are mixed
action / reply and events.

### Installing

    $ npm install jmsg

### Usage

    var jmsg = require('jmsg');

    jmsg.stream(socket, {
        foobar: function(obj) {
            /* ... */
        };
    });

The `jmsg.stream(stream, handlers)` method takes a duplex stream, like a
socket, and an object with message handlers.

There's also `jmsg.cluster([worker], handlers)`, which uses the IPC channel
from the `cluster` module. The worker argument is only used on the master side.

Finally, the main `jmsg(writeFn, handlers)` export is the low-level interface,
where `writeFn` is a function that takes a JSON object to be transmitted to the
`dispatch(obj)` handle method on the side.

Each of these returns a handle, with the following properties:

 - `send(type, [value], [callback])`, method to send a message. Whether a
   callback is specified determines whether the message expects a reply (an
   action) or not (an event).

 - `handlers`, the object containing message handlers.

 - `timeout`, the timeout in milliseconds to wait for a reply to an action,
   before the callback is called with an error.

### Hacking the code

    git clone https://github.com/Two-Screen/jmsg.git
    cd jmsg
    npm install
    npm test
