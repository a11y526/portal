// 설치 화면 설정. 로그인 앱 번호(client id)는 공개해도 되는 값이다(비밀값은 중계 함수에만).
export const CONFIG = {
  relay: 'https://sxejmhkevefwnpwldczt.supabase.co/functions/v1/setup-relay',
  ghClientId: 'Ov23liVMJkX5tXQpuj0Y',
  sbClientId: 'b549a089-0714-489d-9652-261bb2ce9c1c',
  ghAuthorize: 'https://github.com/login/oauth/authorize',
  ghApi: 'https://api.github.com',
  sbAuthorize: 'https://api.supabase.com/v1/oauth/authorize',
  srcOwner: 'a11y526',
  repo: 'science-portal',
  raw: 'https://raw.githubusercontent.com/a11y526/science-portal/main/',
  siteFmt: 'https://{login}.github.io/science-portal/',
  hostFmt: 'https://{ref}.supabase.co',
  originalUrl: 'https://sxejmhkevefwnpwldczt.supabase.co',
  wait: 10000,
};
