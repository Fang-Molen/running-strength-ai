/** Mock transports may replace this in a test; native outbound I/O is forbidden. */
import http from 'node:http';import https from 'node:https';import net from 'node:net';import tls from 'node:tls';
const deny=()=>{throw Error('OFFLINE_EVALUATION_NETWORK_FORBIDDEN')};globalThis.fetch=async()=>deny();
http.request=deny;http.get=deny;https.request=deny;https.get=deny;net.connect=deny;net.createConnection=deny;tls.connect=deny;
