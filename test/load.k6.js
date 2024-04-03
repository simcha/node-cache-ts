import http from 'k6/http';
import { sleep, check, fail } from 'k6';
export const options = {
  vus: 100,
  duration: '160s',
};

export default function () {
    const rndNumber = Math.floor(Math.random() * 1000);
    //The url is like this /{raw,node,snow}/{sleep_time}/{key}/{value}/{error probability 0..1}
    
    // const res = http.get(`http://host.docker.internal:7878/raw/200/${rndNumber}/rose/0`,{
    //     tags: { name: 'sleep' },
    // });
    
    // const res = http.get(`http://host.docker.internal:7878/node/200/${rndNumber}/rose/0`,{
    //     tags: { name: 'node' },
    // });
    
    const res = http.get(`http://host.docker.internal:7878/snow/200/${rndNumber}/rose/0`,{
        tags: { name: 'snow' },
    });

    // const res = http.get(`http://host.docker.internal:7878/node/200/${rndNumber}/rose/0.01`,{
    //     tags: { name: 'node' },
    // });

    check(res, {
        'response code was 200': (res) => res.status == 200
    });
    sleep(0.05);
}