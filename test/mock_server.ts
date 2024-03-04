import http from 'http';
import NodeCache from '../src/node_cache';
import { SnowCache } from '../src/snow_cache';
import { setTimeout } from 'timers/promises';

const usage = `
Use it like this, where 12 is a number of miliseconds to sleep:
http//localhost:7878/{raw,node,snow}/{sleep_time}/{key}/{value}/{error probability 0-1}
`;
const nodeCache = new NodeCache<string>({
	stdTTL: 20
});

const snowCache = new SnowCache<{sleepTime: number, key: string, value: string, flak: number}, string>({
    stdTTL: 20,
    ttr: 0.01
}, async (args: {sleepTime: number, key: string, value: string, flak: number}): Promise<string> => {
    return await mockServiceCall(args.sleepTime, args.key, args.value, args.flak);
});

const mockServiceCall = async (sleepTime: number, key: string, value: string, flak: number) => {
    await setTimeout(sleepTime);
    const answer = `{
            "now":${Date.now()},
            "key":${key},
            "value":${value}
    }\n`;
    if (Math.random() < flak) {
        throw Error('Random error');
    }
    return answer
}

const call = async (cacheType: string, sleepTime: number, key: string, value: string, flak: number): Promise<string> => {
    if (cacheType === 'node') {
        const cachedAnswer = nodeCache.get(key);
        if (cachedAnswer) {
            return cachedAnswer;
        } else {
            await setTimeout(sleepTime);
            const answer = await mockServiceCall(sleepTime, key, value, flak);
            nodeCache.set(key, answer);
            return answer;
        }
    } else if (cacheType === 'snow') {
        return snowCache.call(key, {sleepTime, key, value, flak});
    } else {
        return mockServiceCall(sleepTime, key, value, flak);
    }  
}

http.createServer( async (req, res) => {
    if (req.url === '/') {
        res.writeHead(200, {'Content-Type': 'text/html'});
        res.write('Hello to mock server!\n');
        res.write(usage);
        res.end();
    } else if ((req.url?.startsWith('/sleep/') || req.url?.startsWith('/node/') || req.url?.startsWith('/snow/')) && req.url.split('/')[2]) {
        
        const cacheType: string = req.url.split('/')[1] || 'sleep';
        const sleepTime = Number(req.url.split('/')[2]);
        const key = req.url.split('/')[3] || 'NaN';
        const value = req.url.split('/')[4] || 'NaN';
        const flak =Number(req.url.split('/')[5]);
        
        try{
            const answer = await call(cacheType, sleepTime, key, value, flak);
            res.writeHead(200, {'Content-Type': 'text/html'});
            res.write(answer);
            res.end();
        } catch (err) {
            res.writeHead(500, {'Content-Type': 'text/html'});    
            res.end();
        }

    } else {
        res.writeHead(404, {'Content-Type': 'text/html'});
        res.write("Goto main page '/'!\n");
        res.write(usage);
        res.end();
    }
}).listen(7878);