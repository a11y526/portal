// 설치 화면 중계(본체는 relay.js). 배포: verify_jwt 끔(설치하는 선생님은 이 프로젝트에 로그인하지 않음)
// 비밀값(Edge Functions → Secrets): GH_CLIENT_ID, GH_CLIENT_SECRET, SB_CLIENT_ID, SB_CLIENT_SECRET
import { handle } from './relay.js';

Deno.serve((req: Request) => handle(req, Deno.env.toObject()));
