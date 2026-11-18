cmake_minimum_required(VERSION 3.5.0)
project(tailscale_ohos)

set(NATIVERENDER_ROOT_PATH ${CMAKE_CURRENT_SOURCE_DIR})
set(LIB_DIR ${NATIVERENDER_ROOT_PATH}/../../../libs/${OHOS_ARCH})

include_directories(${NATIVERENDER_ROOT_PATH})

set(GO_ENGINE_SO ${LIB_DIR}/libtailscale_go.so)
if(EXISTS ${GO_ENGINE_SO})
    # 正式路径：链接 Go c-shared 引擎（第三方预编译产物，不入库）。
    include_directories(${LIB_DIR})
    add_library(tailscale_go SHARED IMPORTED)
    set_target_properties(tailscale_go PROPERTIES
        IMPORTED_LOCATION ${GO_ENGINE_SO})
else()
    # 回退路径：引擎产物缺失时用桩实现，保证 HAP 可编译；Tailscale 页报引擎不可用。
    # 把 libtailscale_go.so/.h 放回 entry/libs/<abi>/ 后会自动切回上面的正式路径。
    message(WARNING "libtailscale_go.so not found; building the Tailscale stub (engine disabled)")
    include_directories(${NATIVERENDER_ROOT_PATH}/libtailscale_stub)
    add_library(tailscale_go SHARED libtailscale_stub/libtailscale_go_stub.c)
endif()

add_library(tailscale_ohos SHARED napi_init.cpp)

target_link_libraries(tailscale_ohos PUBLIC tailscale_go libace_napi.z.so libhilog_ndk.z.so)
