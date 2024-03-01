import http from 'k6/http';
import { sleep } from 'k6';
export const options = {
  vus: 100,
  duration: '60s',
};

export default function () {
    http.get(`http://host.docker.internal:7878/node/200/${Math.floor(Math.random()*1000)}/beauty`,{
        tags: { name: 'node' },
      });
    sleep(0.05);
}