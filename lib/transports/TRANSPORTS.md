# transport

A transport implements the following methods:

- `open`
- `get`
- `destroy`

When a transport is created, options applicable to the transport type
 are passed for the first argument.

The second argument is the user supplied handler (from `sip.start` or
`sip.create`) which gets called with the SIP message as the first
argument, and the remote address info as the second argument.
