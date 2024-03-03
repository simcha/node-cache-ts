import http from 'k6/http';
import { sleep, check, fail } from 'k6';
//import { Trend } from 'k6/metrics';

//const myTrend = new Trend('how_old');

export const options = {
  vus: 100,
  duration: '160s',
};

export default function () {
    const rndNumber = Math.floor(Math.random() * 1000);
    const res = http.get(`http://host.docker.internal:7878/node/200/${rndNumber}/rose/0.01`,{
        tags: { name: 'node' },
    });
    const checkOutput = check(res, {
        'response code was 200': (res) => res.status == 200
    });
    //myTrend.add(Date.now()-Number(res.json()['now']))
    sleep(0.05);
    // if (!checkOutput) {
    //     fail('Response code was not 200');
    // }
}