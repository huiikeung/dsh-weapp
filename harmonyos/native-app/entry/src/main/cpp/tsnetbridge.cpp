#include "napi/native_api.h"
#include <dlfcn.h>
#include <string>
#include <cstdint>
#include <pthread.h>

typedef unsigned long long (*CreateFn)(const char*, const char*);
typedef char* (*StringFn)(unsigned long long, int);
typedef void (*FreeFn)(char*);
typedef void (*CloseFn)(unsigned long long);
typedef int (*ForwardFn)(unsigned long long,const char*,int);
static unsigned long long gNode = 0;
static void* lib(){ static void* h=nullptr; if(!h) h=dlopen("libtsnetgo.so",RTLD_NOW); return h; }
static napi_value text(napi_env e,const std::string&s){napi_value r;napi_create_string_utf8(e,s.c_str(),NAPI_AUTO_LENGTH,&r);return r;}
struct PingResult { int (*fn)(); int value; };
static void* pingThread(void*arg){PingResult*x=(PingResult*)arg;x->value=x->fn();return nullptr;}
static napi_value ThreadPing(napi_env e,napi_callback_info){void*h=lib();if(!h)return text(e,"DLOPEN_ERR");auto fn=(int(*)())dlsym(h,"TsPing");if(!fn)return text(e,"SYMBOL_ERR");PingResult x{fn,0};pthread_t th;if(pthread_create(&th,nullptr,pingThread,&x)!=0)return text(e,"PTHREAD_ERR");pthread_join(th,nullptr);return text(e,std::to_string(x.value));}
static napi_value Ping(napi_env e,napi_callback_info){void*h=lib();if(!h)return text(e,"DLOPEN_ERR");typedef int(*Fn)();auto fn=(Fn)dlsym(h,"TsPing");if(!fn)return text(e,"SYMBOL_ERR");return text(e,std::to_string(fn()));}
static napi_value Probe(napi_env e,napi_callback_info){void*h=lib();if(!h){const char*x=dlerror();return text(e,std::string("DLOPEN_ERR:")+(x?x:"unknown"));}return text(e,dlsym(h,"TsCreate")?"DLOPEN_OK_TsCreate":"DLOPEN_OK_NO_SYMBOL");}
struct ThreadResult { CreateFn fn; unsigned long long id; };
static void* createThread(void* arg){ThreadResult* x=(ThreadResult*)arg;x->id=x->fn("dsh-ohos-thread", "/data/storage/el2/base/haps/entry/files/tsnet-thread");return nullptr;}
static napi_value ThreadCreate(napi_env e,napi_callback_info){void*h=lib();if(!h)return text(e,"DLOPEN_ERR");auto fn=(CreateFn)dlsym(h,"TsCreate");if(!fn)return text(e,"SYMBOL_ERR");ThreadResult x{fn,0};pthread_t th;if(pthread_create(&th,nullptr,createThread,&x)!=0)return text(e,"PTHREAD_ERR");pthread_join(th,nullptr);gNode=x.id;return text(e,std::to_string(x.id));}
static napi_value CreateOnly(napi_env e,napi_callback_info){void*h=lib();if(!h)return text(e,"DLOPEN_ERR");auto fn=(CreateFn)dlsym(h,"TsCreate");if(!fn)return text(e,"SYMBOL_ERR");auto id=fn("dsh-ohos", "/data/storage/el2/base/haps/entry/files/tsnet-state-probe");gNode=id;return text(e,std::to_string(id));}
static napi_value Login(napi_env e,napi_callback_info){void*h=lib();if(!h)return text(e,"DLOPEN_ERR");auto create=(CreateFn)dlsym(h,"TsCreate");auto fn=(StringFn)dlsym(h,"TsBeginLogin");auto freeFn=(FreeFn)dlsym(h,"TsFree");if(!create||!fn)return text(e,"SYMBOL_ERR");if(gNode==0)gNode=create("dsh-ohos", "/data/storage/el2/base/haps/entry/files/tsnet-state");if(gNode==0)return text(e,"CREATE_ERR");char*out=fn(gNode,12);std::string result=out?out:"NULL";if(out&&freeFn)freeFn(out);return text(e,result);}
static napi_value Forward(napi_env e,napi_callback_info info){size_t argc=2;napi_value args[2];napi_get_cb_info(e,info,&argc,args,nullptr,nullptr);if(argc<2)return text(e,"ARG_ERR");char host[256];size_t hostLen=sizeof(host)-1;napi_get_value_string_utf8(e,args[0],host,sizeof(host),&hostLen);host[hostLen]=0;int32_t port=0;napi_get_value_int32(e,args[1],&port);void*h=lib();if(!h||!gNode)return text(e,"NOT_READY");auto fn=(ForwardFn)dlsym(h,"TsForward");if(!fn)return text(e,"SYMBOL_ERR");int p=fn(gNode,host,port);return text(e,std::to_string(p));}
static napi_value Status(napi_env e,napi_callback_info){void*h=lib();if(!h||!gNode)return text(e,"NOT_READY");typedef char*(*Fn)(unsigned long long);auto fn=(Fn)dlsym(h,"TsStatus");auto freeFn=(FreeFn)dlsym(h,"TsFree");if(!fn)return text(e,"SYMBOL_ERR");char*out=fn(gNode);std::string result=out?out:"NULL";if(out&&freeFn)freeFn(out);return text(e,result);}
static napi_value Close(napi_env e,napi_callback_info){void*h=lib();if(h&&gNode){auto fn=(CloseFn)dlsym(h,"TsClose");if(fn)fn(gNode);gNode=0;}return text(e,"closed");}
EXTERN_C_START
static napi_value Init(napi_env e,napi_value x){napi_property_descriptor d[]={{"probe",nullptr,Probe,nullptr,nullptr,nullptr,napi_default,nullptr},{"ping",nullptr,Ping,nullptr,nullptr,nullptr,napi_default,nullptr},{"threadPing",nullptr,ThreadPing,nullptr,nullptr,nullptr,napi_default,nullptr},{"login",nullptr,Login,nullptr,nullptr,nullptr,napi_default,nullptr},{"createOnly",nullptr,CreateOnly,nullptr,nullptr,nullptr,napi_default,nullptr},{"threadCreate",nullptr,ThreadCreate,nullptr,nullptr,nullptr,napi_default,nullptr},{"close",nullptr,Close,nullptr,nullptr,nullptr,napi_default,nullptr}};napi_define_properties(e,x,7,d);return x;}
EXTERN_C_END
static napi_module m={.nm_version=1,.nm_flags=0,.nm_filename=nullptr,.nm_register_func=Init,.nm_modname="tsnetbridge",.nm_priv=nullptr,.reserved={0}};
extern "C" __attribute__((constructor)) void RegisterTsnetBridge(){napi_module_register(&m);}

