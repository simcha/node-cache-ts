import http from 'http';
import NodeCache from '../src/node_cache';
import { SelfRefreshingCache } from '../src/self-refreshing-cache';
import { setTimeout } from 'timers/promises';

const usage = `
Use it like this, where 12 is a number of miliseconds to sleep:
http//localhost:7878/sleep/12/key/value
`;
const nodeCache = new NodeCache<string>({
	stdTTL: 20
});

const snowCache = new SelfRefreshingCache<{sleepTime: number, key: string, value: string}, string>({
    stdTTL: 20
}, async (args: {sleepTime: number, key: string, value: string}): Promise<string> => {
    console.log(args.key);
    return await mockServiceCall(args.sleepTime, args.key, args.value);
});

const mockServiceCall = async (sleepTime: number, key: string, value: string) => {
    const answer = `${key}:${value}\n`;
    await setTimeout(sleepTime);
    return answer;
}

const call = async (cacheType: string, sleepTime: number, key: string, value: string): Promise<string> => {
    if (cacheType === 'node') {
        const cachedAnswer = nodeCache.get(key);
        if (cachedAnswer) {
            return cachedAnswer;
        } else {
            await setTimeout(sleepTime);
            const answer = await mockServiceCall(sleepTime, key, value);
            nodeCache.set(key, answer);
            return answer;
        }
    } else if (cacheType === 'snow') {
        return snowCache.getSet(key, {sleepTime, key, value});
    } else {
        return mockServiceCall(sleepTime, key, value);
    }  
}

http.createServer( async (req, res) => {
    if (req.url === '/') {
        res.writeHead(200, {'Content-Type': 'text/plain'});
        res.write('Hello to mock server!\n');
        res.write(usage);
        res.end();
    } else if ((req.url?.startsWith('/sleep/') || req.url?.startsWith('/node/') || req.url?.startsWith('/snow/')) && req.url.split('/')[2]) {
        res.writeHead(200, {'Content-Type': 'text/plain'});

        const cacheType: string = req.url.split('/')[1] || 'sleep';
        const sleepTime = Number(req.url.split('/')[2]);
        const key = req.url.split('/')[3] || 'NaN';
        const value = req.url.split('/')[4] || 'NaN';
        
        res.write(sleepTime+"ms\n");
        
        const answer = await call(cacheType, sleepTime, key, value);
        res.write(answer);
        res.end();
    } else {
        res.writeHead(404, {'Content-Type': 'text/plain'});
        res.write("Goto main page '/'!\n");
        res.write(usage);
        res.end();
    }
}).listen(7878);