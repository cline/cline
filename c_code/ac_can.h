/*==============================================================*
 * 文件名称：04_FOTON_VM2_ALL_Matrix_CAN_V1_323f7198d2d6a657ac9eaea43a43ed1a.h
 * 创 建 者：汽车电子研发部
 * 创建日期：2025-10-20
 * 描    述：DBC信号解析头文件
 * 编码格式：UTF-8 with BOM
 * 编程规范：研发中心编程规范V1.0
 *==============================================================*/

#pragma once
#include <stdint.h>
#include <stdbool.h>

/* 调试开关配置 */
#ifdef DEBUG_ENABLE
    #include <stdio.h>
    #include <stdlib.h>
    #define DBG_PRINT(fmt, ...) \
        printf("[DEBUG][%s:%d] " fmt, __FILE__, __LINE__, ##__VA_ARGS__)
    #define ERROR_TRAP(condition, msg) \
        do { \
            if (!(condition)) { \
                fprintf(stderr, "[ERROR][%s:%d] %s\n", __FILE__, __LINE__, msg); \
                exit(EXIT_FAILURE); \
            } \
        } while(0)
#else
    #define DBG_PRINT(fmt, ...)
    #define ERROR_TRAP(condition, msg) do { if (!(condition)) { return false; } } while(0)
#endif

/* 信号结构体定义 */
typedef struct {
    uint32_t id;                // 报文ID
    uint8_t dlc;                // 数据长度
    uint8_t data[8];            // 原始数据
} CAN_Frame;

/* EMS_3报文定义 (ID:0x120) */
typedef struct {
    float EMS3_F_EngineSpeed;    // 发动机转速错误状态 []
    float EMS3_N_EngineSpeed;    // 发动机转速 [rpm]
} EMS_3_t;
/* Brake_1报文定义 (ID:0x130) */
typedef struct {
    float BR1_N_VehicleSpeed;    // 车速 [km/h]
} BRAKE_1_t;
/* PEPS_1报文定义 (ID:0x166) */
typedef struct {
    float PEPS1_St_RemoteControlSt;    // 远程控制信号（VM2预留此信号发0） []
} PEPS_1_t;
/* EMS_2报文定义 (ID:0x320) */
typedef struct {
    float EMS2_St_ACON;    // 空调压缩机状态（电动空调） []
    float EMS2_F_EngineTemp;    // 发动机冷却水温错误状态 []
    float EMS2_N_EngineTemp;    // 发动机冷却液温度 [℃]
} EMS_2_t;
/* EMS_11报文定义 (ID:0x322) */
typedef struct {
    float EMS11_N_SoakTime;    // 从上一次的KL15下电开始计时，到下一次启动成功停止计时，这段时间soaktime一直累加，在发动机启动成功后值不再累加也不会清零，会一直保持当前值，直到再次 KL15下电后值清零然后重新累加 [minute]
} EMS_11_t;
/* TCM_1报文定义 (ID:0x326) */
typedef struct {
    float TCM1_N_SLP;    // 档位信息 []
} TCM_1_t;
/* AUDIO_7报文定义 (ID:0x347) */
typedef struct {
    float AUDIO7_St_FlowModeVoiceControl;    // 吹风模式电动空调不收 []
    float AUDIO7_St_SetTempVoiceControl_L;    // 温度设置_左侧电动空调也需要接收(物理开关和大屏软开关平台化，按左右物理位置发送，不区分左右舵，不做镜像，单温区只发左侧开关) []
    float AUDIO7_S_FrontDefrostVoiceControl;    // 前除霜开关 []
    float AUDIO7_S_AutoVoiceControl;    // 自动空调开关 []
    float AUDIO7_S_AirCirculateVoiceControl;    // 循环开关 []
    float AUDIO7_S_ACCompresSwitchVoiceControl;    // AC开关 []
    float AUDIO7_S_CLMWorkVoiceControl;    // 空调关闭开关 []
    float AUDIO7_S_SYNC;    // 语音同步 []
    float AUDIO7_St_BlowerSpdSetVoiceControl;    // 鼓风机转速调节 []
    float AUDIO7_S_RearDefrostVoiceControl;    // 语音后除霜开关 []
    float AUDIO7_St_SetTempVoiceControl_R;    // 温度设置_右侧电动空调不收、单温区不收(物理开关和大屏软开关平台化，按左右物理位置发送，不区分左右舵，不做镜像，单温区只发左侧开关)VM2预留 []
} AUDIO_7_t;
/* BCM_1报文定义 (ID:0x363) */
typedef struct {
    float BCM1_St_ReverseGear;    // 倒档MT和AT都需要发送(MT对应硬线，AT做信号映射) []
    float BCM1_F_ReverseGear;    // 倒档有效位MT和AT都需要发送(MT对应硬线，AT做信号映射) []
    float BCM1_N_PM25Value;    // PM2.5浓度（电动空调不发） [ug/m^3]
} BCM_1_t;
/* AC_1报文定义 (ID:0x36C) */
typedef struct {
    float AC1_Checksum;    // Checksum []
    float AC1_S_AC;    // AC开关状态 []
    float AC1_St_Blower;    // 风机档位 []
    float AC1_H_L_PRESS_Sta;    // 高低压力开关状态 []
    float AC1_St_AirCirculate;    // 循环风门 []
    float AC1_MID_PRESS_Status;    // 中压压力开关状态 []
    float AC1_St_FlowMode;    // 模式风门 []
} AC_1_t;
/* AUDIO_4报文定义 (ID:0x374) */
typedef struct {
    float AUDIO4_S_PM25AirClean;    // AUDIO4_S_PM25AirClean []
    float AUDIO4_S_SetTempDown_R;    // 温度下降按下按钮发1（发三次），松开后发0，区别长短按，长按一直发0VM2预留 []
    float AUDIO4_S_SetTempUp_L;    // 温度上升按下按钮发1（发三次），松开后发0，区别长短按，长按一直发0 []
    float AUDIO4_S_SetTempDown_L;    // 温度下降按下按钮发1（发三次），松开后发0，区别长短按，长按一直发0 []
    float AUDIO4_S_SYNC;    // 同步按下按钮发1，松开后发0VM2预留 []
    float AUDIO4_St_SetTemp_L;    // 温度设置_左侧电动空调不收(物理开关和大屏软开关平台化，按左右物理位置发送，不区分左右舵，不做镜像，单温区只发左侧开关)VM2:只做自动空调前空调的温度设置 []
    float AUDIO4_S_TempLevelElectricAC;    // 温度档位(只有电动空调接收)VM2：预留 []
    float AUDIO4_St_SetBlower;    // 风机档位设置 []
    float AUDIO4_S_NegativeIon;    // 负离子的开关命令 []
    float AUDIO4_S_Auto;    // 自动空调开关 []
    float AUDIO4_S_AirCirculate;    // 循环开关 []
    float AUDIO4_S_ACCompresSwitch;    // AC开关 []
    float AUDIO4_S_CLMOFF;    // 空调关闭开关 []
    float AUDIO4_S_RearDefrost;    // 后除霜开关 []
    float AUDIO4_S_FRMPositionSet;    // 香氛位置设置命令 []
} AUDIO_4_t;
/* AC_2报文定义 (ID:0x46C) */
typedef struct {
    float AC2_Checksum;    // Checksum []
    float AC2_N_InsideCarTemp;    // 车内温度 []
    float AC2_N_EnvironmentTemp;    // 环境温度（电动/自动空调都能发，传统车发，电动车不发） []
    float AC2_St_SetTempAutomaticAC_L;    // 温度设置_左侧电动空调不发(物理开关和大屏软开关平台化，按左右物理位置发送，不区分左右舵，不做镜像，单温区只发左侧开关) []
    float AC2_St_TempLevelElectricAC;    // 温度档位(电动空调发温度档位信号，大屏对电动空调不做策略所以不收) []
    float AC2_St_FLSeatHeating;    // 左前座椅加热状态 []
    float AC2_St_RemoteControl;    // 空调成功接收到TBOX远程启动空调命令接收到远程启动命令，水温不满足空调启动条件时发送信号值1VM2:预留此信号 []
} AC_2_t;
/* TBOX_1报文定义 (ID:0x478) */
typedef struct {
    float TBOX1_St_FrontDefrost;    // TBOX1_St_FrontDefrost []
    float TBOX1_St_CLM;    // 远程控制空调（VM2预留） []
    float TBOX1_St_ACSetTemp;    // 远程空调设置（VM2预留） []
} TBOX_1_t;
/* AC_4报文定义 (ID:0x57C) */
typedef struct {
    float AC4_Checksum;    // Checksum []
    float AC4_Front_EVAP_Temp;    // AC4_Front_EVAP_Temp [℃]
} AC_4_t;

/* API函数声明 */
// 获取发动机转速错误状态信号值
bool Get_EMS3_F_EngineSpeed(const CAN_Frame* frame, float* value);

// 设置发动机转速错误状态信号值
bool Set_EMS3_F_EngineSpeed(CAN_Frame* frame, float value);
// 获取发动机转速信号值
bool Get_EMS3_N_EngineSpeed(const CAN_Frame* frame, float* value);

// 设置发动机转速信号值
bool Set_EMS3_N_EngineSpeed(CAN_Frame* frame, float value);
// 获取车速信号值
bool Get_BR1_N_VehicleSpeed(const CAN_Frame* frame, float* value);

// 设置车速信号值
bool Set_BR1_N_VehicleSpeed(CAN_Frame* frame, float value);
// 获取远程控制信号（VM2预留此信号发0）信号值
bool Get_PEPS1_St_RemoteControlSt(const CAN_Frame* frame, float* value);

// 设置远程控制信号（VM2预留此信号发0）信号值
bool Set_PEPS1_St_RemoteControlSt(CAN_Frame* frame, float value);
// 获取空调压缩机状态（电动空调）信号值
bool Get_EMS2_St_ACON(const CAN_Frame* frame, float* value);

// 设置空调压缩机状态（电动空调）信号值
bool Set_EMS2_St_ACON(CAN_Frame* frame, float value);
// 获取发动机冷却水温错误状态信号值
bool Get_EMS2_F_EngineTemp(const CAN_Frame* frame, float* value);

// 设置发动机冷却水温错误状态信号值
bool Set_EMS2_F_EngineTemp(CAN_Frame* frame, float value);
// 获取发动机冷却液温度信号值
bool Get_EMS2_N_EngineTemp(const CAN_Frame* frame, float* value);

// 设置发动机冷却液温度信号值
bool Set_EMS2_N_EngineTemp(CAN_Frame* frame, float value);
// 获取从上一次的KL15下电开始计时，到下一次启动成功停止计时，这段时间soaktime一直累加，在发动机启动成功后值不再累加也不会清零，会一直保持当前值，直到再次 KL15下电后值清零然后重新累加信号值
bool Get_EMS11_N_SoakTime(const CAN_Frame* frame, float* value);

// 设置从上一次的KL15下电开始计时，到下一次启动成功停止计时，这段时间soaktime一直累加，在发动机启动成功后值不再累加也不会清零，会一直保持当前值，直到再次 KL15下电后值清零然后重新累加信号值
bool Set_EMS11_N_SoakTime(CAN_Frame* frame, float value);
// 获取档位信息信号值
bool Get_TCM1_N_SLP(const CAN_Frame* frame, float* value);

// 设置档位信息信号值
bool Set_TCM1_N_SLP(CAN_Frame* frame, float value);
// 获取吹风模式电动空调不收信号值
bool Get_AUDIO7_St_FlowModeVoiceControl(const CAN_Frame* frame, float* value);

// 设置吹风模式电动空调不收信号值
bool Set_AUDIO7_St_FlowModeVoiceControl(CAN_Frame* frame, float value);
// 获取温度设置_左侧电动空调也需要接收(物理开关和大屏软开关平台化，按左右物理位置发送，不区分左右舵，不做镜像，单温区只发左侧开关)信号值
bool Get_AUDIO7_St_SetTempVoiceControl_L(const CAN_Frame* frame, float* value);

// 设置温度设置_左侧电动空调也需要接收(物理开关和大屏软开关平台化，按左右物理位置发送，不区分左右舵，不做镜像，单温区只发左侧开关)信号值
bool Set_AUDIO7_St_SetTempVoiceControl_L(CAN_Frame* frame, float value);
// 获取前除霜开关信号值
bool Get_AUDIO7_S_FrontDefrostVoiceControl(const CAN_Frame* frame, float* value);

// 设置前除霜开关信号值
bool Set_AUDIO7_S_FrontDefrostVoiceControl(CAN_Frame* frame, float value);
// 获取自动空调开关信号值
bool Get_AUDIO7_S_AutoVoiceControl(const CAN_Frame* frame, float* value);

// 设置自动空调开关信号值
bool Set_AUDIO7_S_AutoVoiceControl(CAN_Frame* frame, float value);
// 获取循环开关信号值
bool Get_AUDIO7_S_AirCirculateVoiceControl(const CAN_Frame* frame, float* value);

// 设置循环开关信号值
bool Set_AUDIO7_S_AirCirculateVoiceControl(CAN_Frame* frame, float value);
// 获取AC开关信号值
bool Get_AUDIO7_S_ACCompresSwitchVoiceControl(const CAN_Frame* frame, float* value);

// 设置AC开关信号值
bool Set_AUDIO7_S_ACCompresSwitchVoiceControl(CAN_Frame* frame, float value);
// 获取空调关闭开关信号值
bool Get_AUDIO7_S_CLMWorkVoiceControl(const CAN_Frame* frame, float* value);

// 设置空调关闭开关信号值
bool Set_AUDIO7_S_CLMWorkVoiceControl(CAN_Frame* frame, float value);
// 获取语音同步信号值
bool Get_AUDIO7_S_SYNC(const CAN_Frame* frame, float* value);

// 设置语音同步信号值
bool Set_AUDIO7_S_SYNC(CAN_Frame* frame, float value);
// 获取鼓风机转速调节信号值
bool Get_AUDIO7_St_BlowerSpdSetVoiceControl(const CAN_Frame* frame, float* value);

// 设置鼓风机转速调节信号值
bool Set_AUDIO7_St_BlowerSpdSetVoiceControl(CAN_Frame* frame, float value);
// 获取语音后除霜开关信号值
bool Get_AUDIO7_S_RearDefrostVoiceControl(const CAN_Frame* frame, float* value);

// 设置语音后除霜开关信号值
bool Set_AUDIO7_S_RearDefrostVoiceControl(CAN_Frame* frame, float value);
// 获取温度设置_右侧电动空调不收、单温区不收(物理开关和大屏软开关平台化，按左右物理位置发送，不区分左右舵，不做镜像，单温区只发左侧开关)VM2预留信号值
bool Get_AUDIO7_St_SetTempVoiceControl_R(const CAN_Frame* frame, float* value);

// 设置温度设置_右侧电动空调不收、单温区不收(物理开关和大屏软开关平台化，按左右物理位置发送，不区分左右舵，不做镜像，单温区只发左侧开关)VM2预留信号值
bool Set_AUDIO7_St_SetTempVoiceControl_R(CAN_Frame* frame, float value);
// 获取倒档MT和AT都需要发送(MT对应硬线，AT做信号映射)信号值
bool Get_BCM1_St_ReverseGear(const CAN_Frame* frame, float* value);

// 设置倒档MT和AT都需要发送(MT对应硬线，AT做信号映射)信号值
bool Set_BCM1_St_ReverseGear(CAN_Frame* frame, float value);
// 获取倒档有效位MT和AT都需要发送(MT对应硬线，AT做信号映射)信号值
bool Get_BCM1_F_ReverseGear(const CAN_Frame* frame, float* value);

// 设置倒档有效位MT和AT都需要发送(MT对应硬线，AT做信号映射)信号值
bool Set_BCM1_F_ReverseGear(CAN_Frame* frame, float value);
// 获取PM2.5浓度（电动空调不发）信号值
bool Get_BCM1_N_PM25Value(const CAN_Frame* frame, float* value);

// 设置PM2.5浓度（电动空调不发）信号值
bool Set_BCM1_N_PM25Value(CAN_Frame* frame, float value);
// 获取Checksum信号值
bool Get_AC1_Checksum(const CAN_Frame* frame, float* value);

// 设置Checksum信号值
bool Set_AC1_Checksum(CAN_Frame* frame, float value);
// 获取AC开关状态信号值
bool Get_AC1_S_AC(const CAN_Frame* frame, float* value);

// 设置AC开关状态信号值
bool Set_AC1_S_AC(CAN_Frame* frame, float value);
// 获取风机档位信号值
bool Get_AC1_St_Blower(const CAN_Frame* frame, float* value);

// 设置风机档位信号值
bool Set_AC1_St_Blower(CAN_Frame* frame, float value);
// 获取高低压力开关状态信号值
bool Get_AC1_H_L_PRESS_Sta(const CAN_Frame* frame, float* value);

// 设置高低压力开关状态信号值
bool Set_AC1_H_L_PRESS_Sta(CAN_Frame* frame, float value);
// 获取循环风门信号值
bool Get_AC1_St_AirCirculate(const CAN_Frame* frame, float* value);

// 设置循环风门信号值
bool Set_AC1_St_AirCirculate(CAN_Frame* frame, float value);
// 获取中压压力开关状态信号值
bool Get_AC1_MID_PRESS_Status(const CAN_Frame* frame, float* value);

// 设置中压压力开关状态信号值
bool Set_AC1_MID_PRESS_Status(CAN_Frame* frame, float value);
// 获取模式风门信号值
bool Get_AC1_St_FlowMode(const CAN_Frame* frame, float* value);

// 设置模式风门信号值
bool Set_AC1_St_FlowMode(CAN_Frame* frame, float value);
// 获取AUDIO4_S_PM25AirClean信号值
bool Get_AUDIO4_S_PM25AirClean(const CAN_Frame* frame, float* value);

// 设置AUDIO4_S_PM25AirClean信号值
bool Set_AUDIO4_S_PM25AirClean(CAN_Frame* frame, float value);
// 获取温度下降按下按钮发1（发三次），松开后发0，区别长短按，长按一直发0VM2预留信号值
bool Get_AUDIO4_S_SetTempDown_R(const CAN_Frame* frame, float* value);

// 设置温度下降按下按钮发1（发三次），松开后发0，区别长短按，长按一直发0VM2预留信号值
bool Set_AUDIO4_S_SetTempDown_R(CAN_Frame* frame, float value);
// 获取温度上升按下按钮发1（发三次），松开后发0，区别长短按，长按一直发0信号值
bool Get_AUDIO4_S_SetTempUp_L(const CAN_Frame* frame, float* value);

// 设置温度上升按下按钮发1（发三次），松开后发0，区别长短按，长按一直发0信号值
bool Set_AUDIO4_S_SetTempUp_L(CAN_Frame* frame, float value);
// 获取温度下降按下按钮发1（发三次），松开后发0，区别长短按，长按一直发0信号值
bool Get_AUDIO4_S_SetTempDown_L(const CAN_Frame* frame, float* value);

// 设置温度下降按下按钮发1（发三次），松开后发0，区别长短按，长按一直发0信号值
bool Set_AUDIO4_S_SetTempDown_L(CAN_Frame* frame, float value);
// 获取同步按下按钮发1，松开后发0VM2预留信号值
bool Get_AUDIO4_S_SYNC(const CAN_Frame* frame, float* value);

// 设置同步按下按钮发1，松开后发0VM2预留信号值
bool Set_AUDIO4_S_SYNC(CAN_Frame* frame, float value);
// 获取温度设置_左侧电动空调不收(物理开关和大屏软开关平台化，按左右物理位置发送，不区分左右舵，不做镜像，单温区只发左侧开关)VM2:只做自动空调前空调的温度设置信号值
bool Get_AUDIO4_St_SetTemp_L(const CAN_Frame* frame, float* value);

// 设置温度设置_左侧电动空调不收(物理开关和大屏软开关平台化，按左右物理位置发送，不区分左右舵，不做镜像，单温区只发左侧开关)VM2:只做自动空调前空调的温度设置信号值
bool Set_AUDIO4_St_SetTemp_L(CAN_Frame* frame, float value);
// 获取温度档位(只有电动空调接收)VM2：预留信号值
bool Get_AUDIO4_S_TempLevelElectricAC(const CAN_Frame* frame, float* value);

// 设置温度档位(只有电动空调接收)VM2：预留信号值
bool Set_AUDIO4_S_TempLevelElectricAC(CAN_Frame* frame, float value);
// 获取风机档位设置信号值
bool Get_AUDIO4_St_SetBlower(const CAN_Frame* frame, float* value);

// 设置风机档位设置信号值
bool Set_AUDIO4_St_SetBlower(CAN_Frame* frame, float value);
// 获取负离子的开关命令信号值
bool Get_AUDIO4_S_NegativeIon(const CAN_Frame* frame, float* value);

// 设置负离子的开关命令信号值
bool Set_AUDIO4_S_NegativeIon(CAN_Frame* frame, float value);
// 获取自动空调开关信号值
bool Get_AUDIO4_S_Auto(const CAN_Frame* frame, float* value);

// 设置自动空调开关信号值
bool Set_AUDIO4_S_Auto(CAN_Frame* frame, float value);
// 获取循环开关信号值
bool Get_AUDIO4_S_AirCirculate(const CAN_Frame* frame, float* value);

// 设置循环开关信号值
bool Set_AUDIO4_S_AirCirculate(CAN_Frame* frame, float value);
// 获取AC开关信号值
bool Get_AUDIO4_S_ACCompresSwitch(const CAN_Frame* frame, float* value);

// 设置AC开关信号值
bool Set_AUDIO4_S_ACCompresSwitch(CAN_Frame* frame, float value);
// 获取空调关闭开关信号值
bool Get_AUDIO4_S_CLMOFF(const CAN_Frame* frame, float* value);

// 设置空调关闭开关信号值
bool Set_AUDIO4_S_CLMOFF(CAN_Frame* frame, float value);
// 获取后除霜开关信号值
bool Get_AUDIO4_S_RearDefrost(const CAN_Frame* frame, float* value);

// 设置后除霜开关信号值
bool Set_AUDIO4_S_RearDefrost(CAN_Frame* frame, float value);
// 获取香氛位置设置命令信号值
bool Get_AUDIO4_S_FRMPositionSet(const CAN_Frame* frame, float* value);

// 设置香氛位置设置命令信号值
bool Set_AUDIO4_S_FRMPositionSet(CAN_Frame* frame, float value);
// 获取Checksum信号值
bool Get_AC2_Checksum(const CAN_Frame* frame, float* value);

// 设置Checksum信号值
bool Set_AC2_Checksum(CAN_Frame* frame, float value);
// 获取车内温度信号值
bool Get_AC2_N_InsideCarTemp(const CAN_Frame* frame, float* value);

// 设置车内温度信号值
bool Set_AC2_N_InsideCarTemp(CAN_Frame* frame, float value);
// 获取环境温度（电动/自动空调都能发，传统车发，电动车不发）信号值
bool Get_AC2_N_EnvironmentTemp(const CAN_Frame* frame, float* value);

// 设置环境温度（电动/自动空调都能发，传统车发，电动车不发）信号值
bool Set_AC2_N_EnvironmentTemp(CAN_Frame* frame, float value);
// 获取温度设置_左侧电动空调不发(物理开关和大屏软开关平台化，按左右物理位置发送，不区分左右舵，不做镜像，单温区只发左侧开关)信号值
bool Get_AC2_St_SetTempAutomaticAC_L(const CAN_Frame* frame, float* value);

// 设置温度设置_左侧电动空调不发(物理开关和大屏软开关平台化，按左右物理位置发送，不区分左右舵，不做镜像，单温区只发左侧开关)信号值
bool Set_AC2_St_SetTempAutomaticAC_L(CAN_Frame* frame, float value);
// 获取温度档位(电动空调发温度档位信号，大屏对电动空调不做策略所以不收)信号值
bool Get_AC2_St_TempLevelElectricAC(const CAN_Frame* frame, float* value);

// 设置温度档位(电动空调发温度档位信号，大屏对电动空调不做策略所以不收)信号值
bool Set_AC2_St_TempLevelElectricAC(CAN_Frame* frame, float value);
// 获取左前座椅加热状态信号值
bool Get_AC2_St_FLSeatHeating(const CAN_Frame* frame, float* value);

// 设置左前座椅加热状态信号值
bool Set_AC2_St_FLSeatHeating(CAN_Frame* frame, float value);
// 获取空调成功接收到TBOX远程启动空调命令接收到远程启动命令，水温不满足空调启动条件时发送信号值1VM2:预留此信号信号值
bool Get_AC2_St_RemoteControl(const CAN_Frame* frame, float* value);

// 设置空调成功接收到TBOX远程启动空调命令接收到远程启动命令，水温不满足空调启动条件时发送信号值1VM2:预留此信号信号值
bool Set_AC2_St_RemoteControl(CAN_Frame* frame, float value);
// 获取TBOX1_St_FrontDefrost信号值
bool Get_TBOX1_St_FrontDefrost(const CAN_Frame* frame, float* value);

// 设置TBOX1_St_FrontDefrost信号值
bool Set_TBOX1_St_FrontDefrost(CAN_Frame* frame, float value);
// 获取远程控制空调（VM2预留）信号值
bool Get_TBOX1_St_CLM(const CAN_Frame* frame, float* value);

// 设置远程控制空调（VM2预留）信号值
bool Set_TBOX1_St_CLM(CAN_Frame* frame, float value);
// 获取远程空调设置（VM2预留）信号值
bool Get_TBOX1_St_ACSetTemp(const CAN_Frame* frame, float* value);

// 设置远程空调设置（VM2预留）信号值
bool Set_TBOX1_St_ACSetTemp(CAN_Frame* frame, float value);
// 获取Checksum信号值
bool Get_AC4_Checksum(const CAN_Frame* frame, float* value);

// 设置Checksum信号值
bool Set_AC4_Checksum(CAN_Frame* frame, float value);
// 获取AC4_Front_EVAP_Temp信号值
bool Get_AC4_Front_EVAP_Temp(const CAN_Frame* frame, float* value);

// 设置AC4_Front_EVAP_Temp信号值
bool Set_AC4_Front_EVAP_Temp(CAN_Frame* frame, float value);
