/*==============================================================*
 * 文件名称：04_FOTON_VM2_ALL_Matrix_CAN_V1_323f7198d2d6a657ac9eaea43a43ed1a.c
 * 创 建 者：汽车电子研发部
 * 创建日期：2025-10-20
 * 描    述：DBC信号解析实现
 * 编码格式：UTF-8 with BOM
 * 编程规范：研发中心编程规范V1.0
 *==============================================================*/

#include "04_FOTON_VM2_ALL_Matrix_CAN_V1_323f7198d2d6a657ac9eaea43a43ed1a.h"
#include <math.h>
#include <string.h>

/* 信号解析宏定义 */
#define GET_BIT(data, pos) (((data) >> (pos)) & 0x01)
#define SET_BIT(data, pos, value) ((data) = ((data) & ~(1UL << (pos))) | ((value) << (pos)))

/*----------------------------------------------------------------*
 * 函数名：Get_EMS3_F_EngineSpeed
 * 功能：获取发动机转速错误状态信号值
 * 参数：
 *   - frame: CAN帧指针
 *   - value: 输出信号值指针
 * 返回值：操作是否成功
 * 注意：发动机转速错误状态
 *----------------------------------------------------------------*/
bool Get_EMS3_F_EngineSpeed(const CAN_Frame* frame, float* value) {
    // 校验输入参数
    ERROR_TRAP(frame != NULL, "空指针异常");
    ERROR_TRAP(value != NULL, "输出参数无效");
    
    // 校验报文ID
    if (frame->id != 0x120) {
        DBG_PRINT("报文ID不匹配(预期:0x120, 实际:0x%X)", frame->id);
        return false;
    }
    
    // 提取原始信号值
    uint64_t raw_value = 0;
    // 大端模式处理
    for (int i = 0; i < 1; i++) {
        int byte_pos = 1 - (i / 8);
        int bit_pos = 6 + (i % 8);
        SET_BIT(raw_value, i, GET_BIT(frame->data[byte_pos], bit_pos));
    }
    
    // 应用转换公式：物理值 = (原始值 × 1) + 0
    *value = (raw_value * 1) + 0;
    
    // 边界检查
    if (*value < 0 || *value > 1) {
        DBG_PRINT("信号EMS3_F_EngineSpeed越界(值:%.2f, 范围:[%.2f~%.2f])", 
                 *value, 0, 1);
        return false;
    }
    
    DBG_PRINT("获取EMS3_F_EngineSpeed成功: %.2f", *value);
    return true;
}

/*----------------------------------------------------------------*
 * 函数名：Set_EMS3_F_EngineSpeed
 * 功能：设置发动机转速错误状态信号值
 * 参数：
 *   - frame: CAN帧指针
 *   - value: 输入信号值
 * 返回值：操作是否成功
 * 注意：发动机转速错误状态
 *----------------------------------------------------------------*/
bool Set_EMS3_F_EngineSpeed(CAN_Frame* frame, float value) {
    // 边界检查
    if (value < 0 || value > 1) {
        DBG_PRINT("信号EMS3_F_EngineSpeed越界(值:%.2f, 范围:[%.2f~%.2f])", 
                 value, 0, 1);
        return false;
    }
    
    // 计算原始值：原始值 = (物理值 - 0) / 1
    uint64_t raw_value = (uint64_t)round((value - 0) / 1);
    
    // 设置原始信号值
    // 大端模式处理
    for (int i = 0; i < 1; i++) {
        int byte_pos = 1 - (i / 8);
        int bit_pos = 6 + (i % 8);
        uint8_t bit_val = GET_BIT(raw_value, i);
        SET_BIT(frame->data[byte_pos], bit_pos, bit_val);
    }
    
    // 设置报文ID和长度
    frame->id = 0x120;
    frame->dlc = 8;
    
    DBG_PRINT("设置EMS3_F_EngineSpeed成功: %.2f", value);
    return true;
}
/*----------------------------------------------------------------*
 * 函数名：Get_EMS3_N_EngineSpeed
 * 功能：获取发动机转速信号值
 * 参数：
 *   - frame: CAN帧指针
 *   - value: 输出信号值指针
 * 返回值：操作是否成功
 * 注意：发动机转速
 *----------------------------------------------------------------*/
bool Get_EMS3_N_EngineSpeed(const CAN_Frame* frame, float* value) {
    // 校验输入参数
    ERROR_TRAP(frame != NULL, "空指针异常");
    ERROR_TRAP(value != NULL, "输出参数无效");
    
    // 校验报文ID
    if (frame->id != 0x120) {
        DBG_PRINT("报文ID不匹配(预期:0x120, 实际:0x%X)", frame->id);
        return false;
    }
    
    // 提取原始信号值
    uint64_t raw_value = 0;
    // 大端模式处理
    for (int i = 0; i < 16; i++) {
        int byte_pos = 4 - (i / 8);
        int bit_pos = 7 + (i % 8);
        SET_BIT(raw_value, i, GET_BIT(frame->data[byte_pos], bit_pos));
    }
    
    // 应用转换公式：物理值 = (原始值 × 0.25) + 0
    *value = (raw_value * 0.25) + 0;
    
    // 边界检查
    if (*value < 0 || *value > 16383.75) {
        DBG_PRINT("信号EMS3_N_EngineSpeed越界(值:%.2f, 范围:[%.2f~%.2f])", 
                 *value, 0, 16383.75);
        return false;
    }
    
    DBG_PRINT("获取EMS3_N_EngineSpeed成功: %.2frpm", *value);
    return true;
}

/*----------------------------------------------------------------*
 * 函数名：Set_EMS3_N_EngineSpeed
 * 功能：设置发动机转速信号值
 * 参数：
 *   - frame: CAN帧指针
 *   - value: 输入信号值
 * 返回值：操作是否成功
 * 注意：发动机转速
 *----------------------------------------------------------------*/
bool Set_EMS3_N_EngineSpeed(CAN_Frame* frame, float value) {
    // 边界检查
    if (value < 0 || value > 16383.75) {
        DBG_PRINT("信号EMS3_N_EngineSpeed越界(值:%.2f, 范围:[%.2f~%.2f])", 
                 value, 0, 16383.75);
        return false;
    }
    
    // 计算原始值：原始值 = (物理值 - 0) / 0.25
    uint64_t raw_value = (uint64_t)round((value - 0) / 0.25);
    
    // 设置原始信号值
    // 大端模式处理
    for (int i = 0; i < 16; i++) {
        int byte_pos = 4 - (i / 8);
        int bit_pos = 7 + (i % 8);
        uint8_t bit_val = GET_BIT(raw_value, i);
        SET_BIT(frame->data[byte_pos], bit_pos, bit_val);
    }
    
    // 设置报文ID和长度
    frame->id = 0x120;
    frame->dlc = 8;
    
    DBG_PRINT("设置EMS3_N_EngineSpeed成功: %.2frpm", value);
    return true;
}
/*----------------------------------------------------------------*
 * 函数名：Get_BR1_N_VehicleSpeed
 * 功能：获取车速信号值
 * 参数：
 *   - frame: CAN帧指针
 *   - value: 输出信号值指针
 * 返回值：操作是否成功
 * 注意：车速
 *----------------------------------------------------------------*/
bool Get_BR1_N_VehicleSpeed(const CAN_Frame* frame, float* value) {
    // 校验输入参数
    ERROR_TRAP(frame != NULL, "空指针异常");
    ERROR_TRAP(value != NULL, "输出参数无效");
    
    // 校验报文ID
    if (frame->id != 0x130) {
        DBG_PRINT("报文ID不匹配(预期:0x130, 实际:0x%X)", frame->id);
        return false;
    }
    
    // 提取原始信号值
    uint64_t raw_value = 0;
    // 大端模式处理
    for (int i = 0; i < 15; i++) {
        int byte_pos = 4 - (i / 8);
        int bit_pos = 6 + (i % 8);
        SET_BIT(raw_value, i, GET_BIT(frame->data[byte_pos], bit_pos));
    }
    
    // 应用转换公式：物理值 = (原始值 × 0.01) + 0
    *value = (raw_value * 0.01) + 0;
    
    // 边界检查
    if (*value < 0 || *value > 327.66) {
        DBG_PRINT("信号BR1_N_VehicleSpeed越界(值:%.2f, 范围:[%.2f~%.2f])", 
                 *value, 0, 327.66);
        return false;
    }
    
    DBG_PRINT("获取BR1_N_VehicleSpeed成功: %.2fkm/h", *value);
    return true;
}

/*----------------------------------------------------------------*
 * 函数名：Set_BR1_N_VehicleSpeed
 * 功能：设置车速信号值
 * 参数：
 *   - frame: CAN帧指针
 *   - value: 输入信号值
 * 返回值：操作是否成功
 * 注意：车速
 *----------------------------------------------------------------*/
bool Set_BR1_N_VehicleSpeed(CAN_Frame* frame, float value) {
    // 边界检查
    if (value < 0 || value > 327.66) {
        DBG_PRINT("信号BR1_N_VehicleSpeed越界(值:%.2f, 范围:[%.2f~%.2f])", 
                 value, 0, 327.66);
        return false;
    }
    
    // 计算原始值：原始值 = (物理值 - 0) / 0.01
    uint64_t raw_value = (uint64_t)round((value - 0) / 0.01);
    
    // 设置原始信号值
    // 大端模式处理
    for (int i = 0; i < 15; i++) {
        int byte_pos = 4 - (i / 8);
        int bit_pos = 6 + (i % 8);
        uint8_t bit_val = GET_BIT(raw_value, i);
        SET_BIT(frame->data[byte_pos], bit_pos, bit_val);
    }
    
    // 设置报文ID和长度
    frame->id = 0x130;
    frame->dlc = 8;
    
    DBG_PRINT("设置BR1_N_VehicleSpeed成功: %.2fkm/h", value);
    return true;
}
/*----------------------------------------------------------------*
 * 函数名：Get_PEPS1_St_RemoteControlSt
 * 功能：获取远程控制信号（VM2预留此信号发0）信号值
 * 参数：
 *   - frame: CAN帧指针
 *   - value: 输出信号值指针
 * 返回值：操作是否成功
 * 注意：远程控制信号（VM2预留此信号发0）
 *----------------------------------------------------------------*/
bool Get_PEPS1_St_RemoteControlSt(const CAN_Frame* frame, float* value) {
    // 校验输入参数
    ERROR_TRAP(frame != NULL, "空指针异常");
    ERROR_TRAP(value != NULL, "输出参数无效");
    
    // 校验报文ID
    if (frame->id != 0x166) {
        DBG_PRINT("报文ID不匹配(预期:0x166, 实际:0x%X)", frame->id);
        return false;
    }
    
    // 提取原始信号值
    uint64_t raw_value = 0;
    // 大端模式处理
    for (int i = 0; i < 1; i++) {
        int byte_pos = 7 - (i / 8);
        int bit_pos = 5 + (i % 8);
        SET_BIT(raw_value, i, GET_BIT(frame->data[byte_pos], bit_pos));
    }
    
    // 应用转换公式：物理值 = (原始值 × 1) + 0
    *value = (raw_value * 1) + 0;
    
    // 边界检查
    if (*value < 0 || *value > 1) {
        DBG_PRINT("信号PEPS1_St_RemoteControlSt越界(值:%.2f, 范围:[%.2f~%.2f])", 
                 *value, 0, 1);
        return false;
    }
    
    DBG_PRINT("获取PEPS1_St_RemoteControlSt成功: %.2f", *value);
    return true;
}

/*----------------------------------------------------------------*
 * 函数名：Set_PEPS1_St_RemoteControlSt
 * 功能：设置远程控制信号（VM2预留此信号发0）信号值
 * 参数：
 *   - frame: CAN帧指针
 *   - value: 输入信号值
 * 返回值：操作是否成功
 * 注意：远程控制信号（VM2预留此信号发0）
 *----------------------------------------------------------------*/
bool Set_PEPS1_St_RemoteControlSt(CAN_Frame* frame, float value) {
    // 边界检查
    if (value < 0 || value > 1) {
        DBG_PRINT("信号PEPS1_St_RemoteControlSt越界(值:%.2f, 范围:[%.2f~%.2f])", 
                 value, 0, 1);
        return false;
    }
    
    // 计算原始值：原始值 = (物理值 - 0) / 1
    uint64_t raw_value = (uint64_t)round((value - 0) / 1);
    
    // 设置原始信号值
    // 大端模式处理
    for (int i = 0; i < 1; i++) {
        int byte_pos = 7 - (i / 8);
        int bit_pos = 5 + (i % 8);
        uint8_t bit_val = GET_BIT(raw_value, i);
        SET_BIT(frame->data[byte_pos], bit_pos, bit_val);
    }
    
    // 设置报文ID和长度
    frame->id = 0x166;
    frame->dlc = 8;
    
    DBG_PRINT("设置PEPS1_St_RemoteControlSt成功: %.2f", value);
    return true;
}
/*----------------------------------------------------------------*
 * 函数名：Get_EMS2_St_ACON
 * 功能：获取空调压缩机状态（电动空调）信号值
 * 参数：
 *   - frame: CAN帧指针
 *   - value: 输出信号值指针
 * 返回值：操作是否成功
 * 注意：空调压缩机状态（电动空调）
 *----------------------------------------------------------------*/
bool Get_EMS2_St_ACON(const CAN_Frame* frame, float* value) {
    // 校验输入参数
    ERROR_TRAP(frame != NULL, "空指针异常");
    ERROR_TRAP(value != NULL, "输出参数无效");
    
    // 校验报文ID
    if (frame->id != 0x320) {
        DBG_PRINT("报文ID不匹配(预期:0x320, 实际:0x%X)", frame->id);
        return false;
    }
    
    // 提取原始信号值
    uint64_t raw_value = 0;
    // 大端模式处理
    for (int i = 0; i < 1; i++) {
        int byte_pos = 1 - (i / 8);
        int bit_pos = 5 + (i % 8);
        SET_BIT(raw_value, i, GET_BIT(frame->data[byte_pos], bit_pos));
    }
    
    // 应用转换公式：物理值 = (原始值 × 1) + 0
    *value = (raw_value * 1) + 0;
    
    // 边界检查
    if (*value < 0 || *value > 1) {
        DBG_PRINT("信号EMS2_St_ACON越界(值:%.2f, 范围:[%.2f~%.2f])", 
                 *value, 0, 1);
        return false;
    }
    
    DBG_PRINT("获取EMS2_St_ACON成功: %.2f", *value);
    return true;
}

/*----------------------------------------------------------------*
 * 函数名：Set_EMS2_St_ACON
 * 功能：设置空调压缩机状态（电动空调）信号值
 * 参数：
 *   - frame: CAN帧指针
 *   - value: 输入信号值
 * 返回值：操作是否成功
 * 注意：空调压缩机状态（电动空调）
 *----------------------------------------------------------------*/
bool Set_EMS2_St_ACON(CAN_Frame* frame, float value) {
    // 边界检查
    if (value < 0 || value > 1) {
        DBG_PRINT("信号EMS2_St_ACON越界(值:%.2f, 范围:[%.2f~%.2f])", 
                 value, 0, 1);
        return false;
    }
    
    // 计算原始值：原始值 = (物理值 - 0) / 1
    uint64_t raw_value = (uint64_t)round((value - 0) / 1);
    
    // 设置原始信号值
    // 大端模式处理
    for (int i = 0; i < 1; i++) {
        int byte_pos = 1 - (i / 8);
        int bit_pos = 5 + (i % 8);
        uint8_t bit_val = GET_BIT(raw_value, i);
        SET_BIT(frame->data[byte_pos], bit_pos, bit_val);
    }
    
    // 设置报文ID和长度
    frame->id = 0x320;
    frame->dlc = 8;
    
    DBG_PRINT("设置EMS2_St_ACON成功: %.2f", value);
    return true;
}
/*----------------------------------------------------------------*
 * 函数名：Get_EMS2_F_EngineTemp
 * 功能：获取发动机冷却水温错误状态信号值
 * 参数：
 *   - frame: CAN帧指针
 *   - value: 输出信号值指针
 * 返回值：操作是否成功
 * 注意：发动机冷却水温错误状态
 *----------------------------------------------------------------*/
bool Get_EMS2_F_EngineTemp(const CAN_Frame* frame, float* value) {
    // 校验输入参数
    ERROR_TRAP(frame != NULL, "空指针异常");
    ERROR_TRAP(value != NULL, "输出参数无效");
    
    // 校验报文ID
    if (frame->id != 0x320) {
        DBG_PRINT("报文ID不匹配(预期:0x320, 实际:0x%X)", frame->id);
        return false;
    }
    
    // 提取原始信号值
    uint64_t raw_value = 0;
    // 大端模式处理
    for (int i = 0; i < 1; i++) {
        int byte_pos = 1 - (i / 8);
        int bit_pos = 7 + (i % 8);
        SET_BIT(raw_value, i, GET_BIT(frame->data[byte_pos], bit_pos));
    }
    
    // 应用转换公式：物理值 = (原始值 × 1) + 0
    *value = (raw_value * 1) + 0;
    
    // 边界检查
    if (*value < 0 || *value > 1) {
        DBG_PRINT("信号EMS2_F_EngineTemp越界(值:%.2f, 范围:[%.2f~%.2f])", 
                 *value, 0, 1);
        return false;
    }
    
    DBG_PRINT("获取EMS2_F_EngineTemp成功: %.2f", *value);
    return true;
}

/*----------------------------------------------------------------*
 * 函数名：Set_EMS2_F_EngineTemp
 * 功能：设置发动机冷却水温错误状态信号值
 * 参数：
 *   - frame: CAN帧指针
 *   - value: 输入信号值
 * 返回值：操作是否成功
 * 注意：发动机冷却水温错误状态
 *----------------------------------------------------------------*/
bool Set_EMS2_F_EngineTemp(CAN_Frame* frame, float value) {
    // 边界检查
    if (value < 0 || value > 1) {
        DBG_PRINT("信号EMS2_F_EngineTemp越界(值:%.2f, 范围:[%.2f~%.2f])", 
                 value, 0, 1);
        return false;
    }
    
    // 计算原始值：原始值 = (物理值 - 0) / 1
    uint64_t raw_value = (uint64_t)round((value - 0) / 1);
    
    // 设置原始信号值
    // 大端模式处理
    for (int i = 0; i < 1; i++) {
        int byte_pos = 1 - (i / 8);
        int bit_pos = 7 + (i % 8);
        uint8_t bit_val = GET_BIT(raw_value, i);
        SET_BIT(frame->data[byte_pos], bit_pos, bit_val);
    }
    
    // 设置报文ID和长度
    frame->id = 0x320;
    frame->dlc = 8;
    
    DBG_PRINT("设置EMS2_F_EngineTemp成功: %.2f", value);
    return true;
}
/*----------------------------------------------------------------*
 * 函数名：Get_EMS2_N_EngineTemp
 * 功能：获取发动机冷却液温度信号值
 * 参数：
 *   - frame: CAN帧指针
 *   - value: 输出信号值指针
 * 返回值：操作是否成功
 * 注意：发动机冷却液温度
 *----------------------------------------------------------------*/
bool Get_EMS2_N_EngineTemp(const CAN_Frame* frame, float* value) {
    // 校验输入参数
    ERROR_TRAP(frame != NULL, "空指针异常");
    ERROR_TRAP(value != NULL, "输出参数无效");
    
    // 校验报文ID
    if (frame->id != 0x320) {
        DBG_PRINT("报文ID不匹配(预期:0x320, 实际:0x%X)", frame->id);
        return false;
    }
    
    // 提取原始信号值
    uint64_t raw_value = 0;
    // 大端模式处理
    for (int i = 0; i < 8; i++) {
        int byte_pos = 2 - (i / 8);
        int bit_pos = 7 + (i % 8);
        SET_BIT(raw_value, i, GET_BIT(frame->data[byte_pos], bit_pos));
    }
    
    // 应用转换公式：物理值 = (原始值 × 0.75) + -48
    *value = (raw_value * 0.75) + -48;
    
    // 边界检查
    if (*value < -48 || *value > 142.5) {
        DBG_PRINT("信号EMS2_N_EngineTemp越界(值:%.2f, 范围:[%.2f~%.2f])", 
                 *value, -48, 142.5);
        return false;
    }
    
    DBG_PRINT("获取EMS2_N_EngineTemp成功: %.2f℃", *value);
    return true;
}

/*----------------------------------------------------------------*
 * 函数名：Set_EMS2_N_EngineTemp
 * 功能：设置发动机冷却液温度信号值
 * 参数：
 *   - frame: CAN帧指针
 *   - value: 输入信号值
 * 返回值：操作是否成功
 * 注意：发动机冷却液温度
 *----------------------------------------------------------------*/
bool Set_EMS2_N_EngineTemp(CAN_Frame* frame, float value) {
    // 边界检查
    if (value < -48 || value > 142.5) {
        DBG_PRINT("信号EMS2_N_EngineTemp越界(值:%.2f, 范围:[%.2f~%.2f])", 
                 value, -48, 142.5);
        return false;
    }
    
    // 计算原始值：原始值 = (物理值 - -48) / 0.75
    uint64_t raw_value = (uint64_t)round((value - -48) / 0.75);
    
    // 设置原始信号值
    // 大端模式处理
    for (int i = 0; i < 8; i++) {
        int byte_pos = 2 - (i / 8);
        int bit_pos = 7 + (i % 8);
        uint8_t bit_val = GET_BIT(raw_value, i);
        SET_BIT(frame->data[byte_pos], bit_pos, bit_val);
    }
    
    // 设置报文ID和长度
    frame->id = 0x320;
    frame->dlc = 8;
    
    DBG_PRINT("设置EMS2_N_EngineTemp成功: %.2f℃", value);
    return true;
}
/*----------------------------------------------------------------*
 * 函数名：Get_EMS11_N_SoakTime
 * 功能：获取从上一次的KL15下电开始计时，到下一次启动成功停止计时，这段时间soaktime一直累加，在发动机启动成功后值不再累加也不会清零，会一直保持当前值，直到再次 KL15下电后值清零然后重新累加信号值
 * 参数：
 *   - frame: CAN帧指针
 *   - value: 输出信号值指针
 * 返回值：操作是否成功
 * 注意：从上一次的KL15下电开始计时，到下一次启动成功停止计时，这段时间soaktime一直累加，在发动机启动成功后值不再累加也不会清零，会一直保持当前值，直到再次 KL15下电后值清零然后重新累加
 *----------------------------------------------------------------*/
bool Get_EMS11_N_SoakTime(const CAN_Frame* frame, float* value) {
    // 校验输入参数
    ERROR_TRAP(frame != NULL, "空指针异常");
    ERROR_TRAP(value != NULL, "输出参数无效");
    
    // 校验报文ID
    if (frame->id != 0x322) {
        DBG_PRINT("报文ID不匹配(预期:0x322, 实际:0x%X)", frame->id);
        return false;
    }
    
    // 提取原始信号值
    uint64_t raw_value = 0;
    // 大端模式处理
    for (int i = 0; i < 16; i++) {
        int byte_pos = 2 - (i / 8);
        int bit_pos = 7 + (i % 8);
        SET_BIT(raw_value, i, GET_BIT(frame->data[byte_pos], bit_pos));
    }
    
    // 应用转换公式：物理值 = (原始值 × 1) + 0
    *value = (raw_value * 1) + 0;
    
    // 边界检查
    if (*value < 0 || *value > 2047) {
        DBG_PRINT("信号EMS11_N_SoakTime越界(值:%.2f, 范围:[%.2f~%.2f])", 
                 *value, 0, 2047);
        return false;
    }
    
    DBG_PRINT("获取EMS11_N_SoakTime成功: %.2fminute", *value);
    return true;
}

/*----------------------------------------------------------------*
 * 函数名：Set_EMS11_N_SoakTime
 * 功能：设置从上一次的KL15下电开始计时，到下一次启动成功停止计时，这段时间soaktime一直累加，在发动机启动成功后值不再累加也不会清零，会一直保持当前值，直到再次 KL15下电后值清零然后重新累加信号值
 * 参数：
 *   - frame: CAN帧指针
 *   - value: 输入信号值
 * 返回值：操作是否成功
 * 注意：从上一次的KL15下电开始计时，到下一次启动成功停止计时，这段时间soaktime一直累加，在发动机启动成功后值不再累加也不会清零，会一直保持当前值，直到再次 KL15下电后值清零然后重新累加
 *----------------------------------------------------------------*/
bool Set_EMS11_N_SoakTime(CAN_Frame* frame, float value) {
    // 边界检查
    if (value < 0 || value > 2047) {
        DBG_PRINT("信号EMS11_N_SoakTime越界(值:%.2f, 范围:[%.2f~%.2f])", 
                 value, 0, 2047);
        return false;
    }
    
    // 计算原始值：原始值 = (物理值 - 0) / 1
    uint64_t raw_value = (uint64_t)round((value - 0) / 1);
    
    // 设置原始信号值
    // 大端模式处理
    for (int i = 0; i < 16; i++) {
        int byte_pos = 2 - (i / 8);
        int bit_pos = 7 + (i % 8);
        uint8_t bit_val = GET_BIT(raw_value, i);
        SET_BIT(frame->data[byte_pos], bit_pos, bit_val);
    }
    
    // 设置报文ID和长度
    frame->id = 0x322;
    frame->dlc = 8;
    
    DBG_PRINT("设置EMS11_N_SoakTime成功: %.2fminute", value);
    return true;
}
/*----------------------------------------------------------------*
 * 函数名：Get_TCM1_N_SLP
 * 功能：获取档位信息信号值
 * 参数：
 *   - frame: CAN帧指针
 *   - value: 输出信号值指针
 * 返回值：操作是否成功
 * 注意：档位信息
 *----------------------------------------------------------------*/
bool Get_TCM1_N_SLP(const CAN_Frame* frame, float* value) {
    // 校验输入参数
    ERROR_TRAP(frame != NULL, "空指针异常");
    ERROR_TRAP(value != NULL, "输出参数无效");
    
    // 校验报文ID
    if (frame->id != 0x326) {
        DBG_PRINT("报文ID不匹配(预期:0x326, 实际:0x%X)", frame->id);
        return false;
    }
    
    // 提取原始信号值
    uint64_t raw_value = 0;
    // 大端模式处理
    for (int i = 0; i < 4; i++) {
        int byte_pos = 2 - (i / 8);
        int bit_pos = 7 + (i % 8);
        SET_BIT(raw_value, i, GET_BIT(frame->data[byte_pos], bit_pos));
    }
    
    // 应用转换公式：物理值 = (原始值 × 1) + 0
    *value = (raw_value * 1) + 0;
    
    // 边界检查
    if (*value < 0 || *value > 15) {
        DBG_PRINT("信号TCM1_N_SLP越界(值:%.2f, 范围:[%.2f~%.2f])", 
                 *value, 0, 15);
        return false;
    }
    
    DBG_PRINT("获取TCM1_N_SLP成功: %.2f", *value);
    return true;
}

/*----------------------------------------------------------------*
 * 函数名：Set_TCM1_N_SLP
 * 功能：设置档位信息信号值
 * 参数：
 *   - frame: CAN帧指针
 *   - value: 输入信号值
 * 返回值：操作是否成功
 * 注意：档位信息
 *----------------------------------------------------------------*/
bool Set_TCM1_N_SLP(CAN_Frame* frame, float value) {
    // 边界检查
    if (value < 0 || value > 15) {
        DBG_PRINT("信号TCM1_N_SLP越界(值:%.2f, 范围:[%.2f~%.2f])", 
                 value, 0, 15);
        return false;
    }
    
    // 计算原始值：原始值 = (物理值 - 0) / 1
    uint64_t raw_value = (uint64_t)round((value - 0) / 1);
    
    // 设置原始信号值
    // 大端模式处理
    for (int i = 0; i < 4; i++) {
        int byte_pos = 2 - (i / 8);
        int bit_pos = 7 + (i % 8);
        uint8_t bit_val = GET_BIT(raw_value, i);
        SET_BIT(frame->data[byte_pos], bit_pos, bit_val);
    }
    
    // 设置报文ID和长度
    frame->id = 0x326;
    frame->dlc = 8;
    
    DBG_PRINT("设置TCM1_N_SLP成功: %.2f", value);
    return true;
}
/*----------------------------------------------------------------*
 * 函数名：Get_AUDIO7_St_FlowModeVoiceControl
 * 功能：获取吹风模式电动空调不收信号值
 * 参数：
 *   - frame: CAN帧指针
 *   - value: 输出信号值指针
 * 返回值：操作是否成功
 * 注意：吹风模式电动空调不收
 *----------------------------------------------------------------*/
bool Get_AUDIO7_St_FlowModeVoiceControl(const CAN_Frame* frame, float* value) {
    // 校验输入参数
    ERROR_TRAP(frame != NULL, "空指针异常");
    ERROR_TRAP(value != NULL, "输出参数无效");
    
    // 校验报文ID
    if (frame->id != 0x347) {
        DBG_PRINT("报文ID不匹配(预期:0x347, 实际:0x%X)", frame->id);
        return false;
    }
    
    // 提取原始信号值
    uint64_t raw_value = 0;
    // 大端模式处理
    for (int i = 0; i < 3; i++) {
        int byte_pos = 2 - (i / 8);
        int bit_pos = 2 + (i % 8);
        SET_BIT(raw_value, i, GET_BIT(frame->data[byte_pos], bit_pos));
    }
    
    // 应用转换公式：物理值 = (原始值 × 1) + 0
    *value = (raw_value * 1) + 0;
    
    // 边界检查
    if (*value < 0 || *value > 7) {
        DBG_PRINT("信号AUDIO7_St_FlowModeVoiceControl越界(值:%.2f, 范围:[%.2f~%.2f])", 
                 *value, 0, 7);
        return false;
    }
    
    DBG_PRINT("获取AUDIO7_St_FlowModeVoiceControl成功: %.2f", *value);
    return true;
}

/*----------------------------------------------------------------*
 * 函数名：Set_AUDIO7_St_FlowModeVoiceControl
 * 功能：设置吹风模式电动空调不收信号值
 * 参数：
 *   - frame: CAN帧指针
 *   - value: 输入信号值
 * 返回值：操作是否成功
 * 注意：吹风模式电动空调不收
 *----------------------------------------------------------------*/
bool Set_AUDIO7_St_FlowModeVoiceControl(CAN_Frame* frame, float value) {
    // 边界检查
    if (value < 0 || value > 7) {
        DBG_PRINT("信号AUDIO7_St_FlowModeVoiceControl越界(值:%.2f, 范围:[%.2f~%.2f])", 
                 value, 0, 7);
        return false;
    }
    
    // 计算原始值：原始值 = (物理值 - 0) / 1
    uint64_t raw_value = (uint64_t)round((value - 0) / 1);
    
    // 设置原始信号值
    // 大端模式处理
    for (int i = 0; i < 3; i++) {
        int byte_pos = 2 - (i / 8);
        int bit_pos = 2 + (i % 8);
        uint8_t bit_val = GET_BIT(raw_value, i);
        SET_BIT(frame->data[byte_pos], bit_pos, bit_val);
    }
    
    // 设置报文ID和长度
    frame->id = 0x347;
    frame->dlc = 8;
    
    DBG_PRINT("设置AUDIO7_St_FlowModeVoiceControl成功: %.2f", value);
    return true;
}
/*----------------------------------------------------------------*
 * 函数名：Get_AUDIO7_St_SetTempVoiceControl_L
 * 功能：获取温度设置_左侧电动空调也需要接收(物理开关和大屏软开关平台化，按左右物理位置发送，不区分左右舵，不做镜像，单温区只发左侧开关)信号值
 * 参数：
 *   - frame: CAN帧指针
 *   - value: 输出信号值指针
 * 返回值：操作是否成功
 * 注意：温度设置_左侧电动空调也需要接收(物理开关和大屏软开关平台化，按左右物理位置发送，不区分左右舵，不做镜像，单温区只发左侧开关)
 *----------------------------------------------------------------*/
bool Get_AUDIO7_St_SetTempVoiceControl_L(const CAN_Frame* frame, float* value) {
    // 校验输入参数
    ERROR_TRAP(frame != NULL, "空指针异常");
    ERROR_TRAP(value != NULL, "输出参数无效");
    
    // 校验报文ID
    if (frame->id != 0x347) {
        DBG_PRINT("报文ID不匹配(预期:0x347, 实际:0x%X)", frame->id);
        return false;
    }
    
    // 提取原始信号值
    uint64_t raw_value = 0;
    // 大端模式处理
    for (int i = 0; i < 5; i++) {
        int byte_pos = 2 - (i / 8);
        int bit_pos = 7 + (i % 8);
        SET_BIT(raw_value, i, GET_BIT(frame->data[byte_pos], bit_pos));
    }
    
    // 应用转换公式：物理值 = (原始值 × 0.5) + 18
    *value = (raw_value * 0.5) + 18;
    
    // 边界检查
    if (*value < 18 || *value > 32) {
        DBG_PRINT("信号AUDIO7_St_SetTempVoiceControl_L越界(值:%.2f, 范围:[%.2f~%.2f])", 
                 *value, 18, 32);
        return false;
    }
    
    DBG_PRINT("获取AUDIO7_St_SetTempVoiceControl_L成功: %.2f", *value);
    return true;
}

/*----------------------------------------------------------------*
 * 函数名：Set_AUDIO7_St_SetTempVoiceControl_L
 * 功能：设置温度设置_左侧电动空调也需要接收(物理开关和大屏软开关平台化，按左右物理位置发送，不区分左右舵，不做镜像，单温区只发左侧开关)信号值
 * 参数：
 *   - frame: CAN帧指针
 *   - value: 输入信号值
 * 返回值：操作是否成功
 * 注意：温度设置_左侧电动空调也需要接收(物理开关和大屏软开关平台化，按左右物理位置发送，不区分左右舵，不做镜像，单温区只发左侧开关)
 *----------------------------------------------------------------*/
bool Set_AUDIO7_St_SetTempVoiceControl_L(CAN_Frame* frame, float value) {
    // 边界检查
    if (value < 18 || value > 32) {
        DBG_PRINT("信号AUDIO7_St_SetTempVoiceControl_L越界(值:%.2f, 范围:[%.2f~%.2f])", 
                 value, 18, 32);
        return false;
    }
    
    // 计算原始值：原始值 = (物理值 - 18) / 0.5
    uint64_t raw_value = (uint64_t)round((value - 18) / 0.5);
    
    // 设置原始信号值
    // 大端模式处理
    for (int i = 0; i < 5; i++) {
        int byte_pos = 2 - (i / 8);
        int bit_pos = 7 + (i % 8);
        uint8_t bit_val = GET_BIT(raw_value, i);
        SET_BIT(frame->data[byte_pos], bit_pos, bit_val);
    }
    
    // 设置报文ID和长度
    frame->id = 0x347;
    frame->dlc = 8;
    
    DBG_PRINT("设置AUDIO7_St_SetTempVoiceControl_L成功: %.2f", value);
    return true;
}
/*----------------------------------------------------------------*
 * 函数名：Get_AUDIO7_S_FrontDefrostVoiceControl
 * 功能：获取前除霜开关信号值
 * 参数：
 *   - frame: CAN帧指针
 *   - value: 输出信号值指针
 * 返回值：操作是否成功
 * 注意：前除霜开关
 *----------------------------------------------------------------*/
bool Get_AUDIO7_S_FrontDefrostVoiceControl(const CAN_Frame* frame, float* value) {
    // 校验输入参数
    ERROR_TRAP(frame != NULL, "空指针异常");
    ERROR_TRAP(value != NULL, "输出参数无效");
    
    // 校验报文ID
    if (frame->id != 0x347) {
        DBG_PRINT("报文ID不匹配(预期:0x347, 实际:0x%X)", frame->id);
        return false;
    }
    
    // 提取原始信号值
    uint64_t raw_value = 0;
    // 大端模式处理
    for (int i = 0; i < 2; i++) {
        int byte_pos = 3 - (i / 8);
        int bit_pos = 4 + (i % 8);
        SET_BIT(raw_value, i, GET_BIT(frame->data[byte_pos], bit_pos));
    }
    
    // 应用转换公式：物理值 = (原始值 × 1) + 0
    *value = (raw_value * 1) + 0;
    
    // 边界检查
    if (*value < 0 || *value > 3) {
        DBG_PRINT("信号AUDIO7_S_FrontDefrostVoiceControl越界(值:%.2f, 范围:[%.2f~%.2f])", 
                 *value, 0, 3);
        return false;
    }
    
    DBG_PRINT("获取AUDIO7_S_FrontDefrostVoiceControl成功: %.2f", *value);
    return true;
}

/*----------------------------------------------------------------*
 * 函数名：Set_AUDIO7_S_FrontDefrostVoiceControl
 * 功能：设置前除霜开关信号值
 * 参数：
 *   - frame: CAN帧指针
 *   - value: 输入信号值
 * 返回值：操作是否成功
 * 注意：前除霜开关
 *----------------------------------------------------------------*/
bool Set_AUDIO7_S_FrontDefrostVoiceControl(CAN_Frame* frame, float value) {
    // 边界检查
    if (value < 0 || value > 3) {
        DBG_PRINT("信号AUDIO7_S_FrontDefrostVoiceControl越界(值:%.2f, 范围:[%.2f~%.2f])", 
                 value, 0, 3);
        return false;
    }
    
    // 计算原始值：原始值 = (物理值 - 0) / 1
    uint64_t raw_value = (uint64_t)round((value - 0) / 1);
    
    // 设置原始信号值
    // 大端模式处理
    for (int i = 0; i < 2; i++) {
        int byte_pos = 3 - (i / 8);
        int bit_pos = 4 + (i % 8);
        uint8_t bit_val = GET_BIT(raw_value, i);
        SET_BIT(frame->data[byte_pos], bit_pos, bit_val);
    }
    
    // 设置报文ID和长度
    frame->id = 0x347;
    frame->dlc = 8;
    
    DBG_PRINT("设置AUDIO7_S_FrontDefrostVoiceControl成功: %.2f", value);
    return true;
}
/*----------------------------------------------------------------*
 * 函数名：Get_AUDIO7_S_AutoVoiceControl
 * 功能：获取自动空调开关信号值
 * 参数：
 *   - frame: CAN帧指针
 *   - value: 输出信号值指针
 * 返回值：操作是否成功
 * 注意：自动空调开关
 *----------------------------------------------------------------*/
bool Get_AUDIO7_S_AutoVoiceControl(const CAN_Frame* frame, float* value) {
    // 校验输入参数
    ERROR_TRAP(frame != NULL, "空指针异常");
    ERROR_TRAP(value != NULL, "输出参数无效");
    
    // 校验报文ID
    if (frame->id != 0x347) {
        DBG_PRINT("报文ID不匹配(预期:0x347, 实际:0x%X)", frame->id);
        return false;
    }
    
    // 提取原始信号值
    uint64_t raw_value = 0;
    // 大端模式处理
    for (int i = 0; i < 2; i++) {
        int byte_pos = 3 - (i / 8);
        int bit_pos = 6 + (i % 8);
        SET_BIT(raw_value, i, GET_BIT(frame->data[byte_pos], bit_pos));
    }
    
    // 应用转换公式：物理值 = (原始值 × 1) + 0
    *value = (raw_value * 1) + 0;
    
    // 边界检查
    if (*value < 0 || *value > 3) {
        DBG_PRINT("信号AUDIO7_S_AutoVoiceControl越界(值:%.2f, 范围:[%.2f~%.2f])", 
                 *value, 0, 3);
        return false;
    }
    
    DBG_PRINT("获取AUDIO7_S_AutoVoiceControl成功: %.2f", *value);
    return true;
}

/*----------------------------------------------------------------*
 * 函数名：Set_AUDIO7_S_AutoVoiceControl
 * 功能：设置自动空调开关信号值
 * 参数：
 *   - frame: CAN帧指针
 *   - value: 输入信号值
 * 返回值：操作是否成功
 * 注意：自动空调开关
 *----------------------------------------------------------------*/
bool Set_AUDIO7_S_AutoVoiceControl(CAN_Frame* frame, float value) {
    // 边界检查
    if (value < 0 || value > 3) {
        DBG_PRINT("信号AUDIO7_S_AutoVoiceControl越界(值:%.2f, 范围:[%.2f~%.2f])", 
                 value, 0, 3);
        return false;
    }
    
    // 计算原始值：原始值 = (物理值 - 0) / 1
    uint64_t raw_value = (uint64_t)round((value - 0) / 1);
    
    // 设置原始信号值
    // 大端模式处理
    for (int i = 0; i < 2; i++) {
        int byte_pos = 3 - (i / 8);
        int bit_pos = 6 + (i % 8);
        uint8_t bit_val = GET_BIT(raw_value, i);
        SET_BIT(frame->data[byte_pos], bit_pos, bit_val);
    }
    
    // 设置报文ID和长度
    frame->id = 0x347;
    frame->dlc = 8;
    
    DBG_PRINT("设置AUDIO7_S_AutoVoiceControl成功: %.2f", value);
    return true;
}
/*----------------------------------------------------------------*
 * 函数名：Get_AUDIO7_S_AirCirculateVoiceControl
 * 功能：获取循环开关信号值
 * 参数：
 *   - frame: CAN帧指针
 *   - value: 输出信号值指针
 * 返回值：操作是否成功
 * 注意：循环开关
 *----------------------------------------------------------------*/
bool Get_AUDIO7_S_AirCirculateVoiceControl(const CAN_Frame* frame, float* value) {
    // 校验输入参数
    ERROR_TRAP(frame != NULL, "空指针异常");
    ERROR_TRAP(value != NULL, "输出参数无效");
    
    // 校验报文ID
    if (frame->id != 0x347) {
        DBG_PRINT("报文ID不匹配(预期:0x347, 实际:0x%X)", frame->id);
        return false;
    }
    
    // 提取原始信号值
    uint64_t raw_value = 0;
    // 大端模式处理
    for (int i = 0; i < 2; i++) {
        int byte_pos = 4 - (i / 8);
        int bit_pos = 1 + (i % 8);
        SET_BIT(raw_value, i, GET_BIT(frame->data[byte_pos], bit_pos));
    }
    
    // 应用转换公式：物理值 = (原始值 × 1) + 0
    *value = (raw_value * 1) + 0;
    
    // 边界检查
    if (*value < 0 || *value > 3) {
        DBG_PRINT("信号AUDIO7_S_AirCirculateVoiceControl越界(值:%.2f, 范围:[%.2f~%.2f])", 
                 *value, 0, 3);
        return false;
    }
    
    DBG_PRINT("获取AUDIO7_S_AirCirculateVoiceControl成功: %.2f", *value);
    return true;
}

/*----------------------------------------------------------------*
 * 函数名：Set_AUDIO7_S_AirCirculateVoiceControl
 * 功能：设置循环开关信号值
 * 参数：
 *   - frame: CAN帧指针
 *   - value: 输入信号值
 * 返回值：操作是否成功
 * 注意：循环开关
 *----------------------------------------------------------------*/
bool Set_AUDIO7_S_AirCirculateVoiceControl(CAN_Frame* frame, float value) {
    // 边界检查
    if (value < 0 || value > 3) {
        DBG_PRINT("信号AUDIO7_S_AirCirculateVoiceControl越界(值:%.2f, 范围:[%.2f~%.2f])", 
                 value, 0, 3);
        return false;
    }
    
    // 计算原始值：原始值 = (物理值 - 0) / 1
    uint64_t raw_value = (uint64_t)round((value - 0) / 1);
    
    // 设置原始信号值
    // 大端模式处理
    for (int i = 0; i < 2; i++) {
        int byte_pos = 4 - (i / 8);
        int bit_pos = 1 + (i % 8);
        uint8_t bit_val = GET_BIT(raw_value, i);
        SET_BIT(frame->data[byte_pos], bit_pos, bit_val);
    }
    
    // 设置报文ID和长度
    frame->id = 0x347;
    frame->dlc = 8;
    
    DBG_PRINT("设置AUDIO7_S_AirCirculateVoiceControl成功: %.2f", value);
    return true;
}
/*----------------------------------------------------------------*
 * 函数名：Get_AUDIO7_S_ACCompresSwitchVoiceControl
 * 功能：获取AC开关信号值
 * 参数：
 *   - frame: CAN帧指针
 *   - value: 输出信号值指针
 * 返回值：操作是否成功
 * 注意：AC开关
 *----------------------------------------------------------------*/
bool Get_AUDIO7_S_ACCompresSwitchVoiceControl(const CAN_Frame* frame, float* value) {
    // 校验输入参数
    ERROR_TRAP(frame != NULL, "空指针异常");
    ERROR_TRAP(value != NULL, "输出参数无效");
    
    // 校验报文ID
    if (frame->id != 0x347) {
        DBG_PRINT("报文ID不匹配(预期:0x347, 实际:0x%X)", frame->id);
        return false;
    }
    
    // 提取原始信号值
    uint64_t raw_value = 0;
    // 大端模式处理
    for (int i = 0; i < 2; i++) {
        int byte_pos = 4 - (i / 8);
        int bit_pos = 3 + (i % 8);
        SET_BIT(raw_value, i, GET_BIT(frame->data[byte_pos], bit_pos));
    }
    
    // 应用转换公式：物理值 = (原始值 × 1) + 0
    *value = (raw_value * 1) + 0;
    
    // 边界检查
    if (*value < 0 || *value > 3) {
        DBG_PRINT("信号AUDIO7_S_ACCompresSwitchVoiceControl越界(值:%.2f, 范围:[%.2f~%.2f])", 
                 *value, 0, 3);
        return false;
    }
    
    DBG_PRINT("获取AUDIO7_S_ACCompresSwitchVoiceControl成功: %.2f", *value);
    return true;
}

/*----------------------------------------------------------------*
 * 函数名：Set_AUDIO7_S_ACCompresSwitchVoiceControl
 * 功能：设置AC开关信号值
 * 参数：
 *   - frame: CAN帧指针
 *   - value: 输入信号值
 * 返回值：操作是否成功
 * 注意：AC开关
 *----------------------------------------------------------------*/
bool Set_AUDIO7_S_ACCompresSwitchVoiceControl(CAN_Frame* frame, float value) {
    // 边界检查
    if (value < 0 || value > 3) {
        DBG_PRINT("信号AUDIO7_S_ACCompresSwitchVoiceControl越界(值:%.2f, 范围:[%.2f~%.2f])", 
                 value, 0, 3);
        return false;
    }
    
    // 计算原始值：原始值 = (物理值 - 0) / 1
    uint64_t raw_value = (uint64_t)round((value - 0) / 1);
    
    // 设置原始信号值
    // 大端模式处理
    for (int i = 0; i < 2; i++) {
        int byte_pos = 4 - (i / 8);
        int bit_pos = 3 + (i % 8);
        uint8_t bit_val = GET_BIT(raw_value, i);
        SET_BIT(frame->data[byte_pos], bit_pos, bit_val);
    }
    
    // 设置报文ID和长度
    frame->id = 0x347;
    frame->dlc = 8;
    
    DBG_PRINT("设置AUDIO7_S_ACCompresSwitchVoiceControl成功: %.2f", value);
    return true;
}
/*----------------------------------------------------------------*
 * 函数名：Get_AUDIO7_S_CLMWorkVoiceControl
 * 功能：获取空调关闭开关信号值
 * 参数：
 *   - frame: CAN帧指针
 *   - value: 输出信号值指针
 * 返回值：操作是否成功
 * 注意：空调关闭开关
 *----------------------------------------------------------------*/
bool Get_AUDIO7_S_CLMWorkVoiceControl(const CAN_Frame* frame, float* value) {
    // 校验输入参数
    ERROR_TRAP(frame != NULL, "空指针异常");
    ERROR_TRAP(value != NULL, "输出参数无效");
    
    // 校验报文ID
    if (frame->id != 0x347) {
        DBG_PRINT("报文ID不匹配(预期:0x347, 实际:0x%X)", frame->id);
        return false;
    }
    
    // 提取原始信号值
    uint64_t raw_value = 0;
    // 大端模式处理
    for (int i = 0; i < 2; i++) {
        int byte_pos = 4 - (i / 8);
        int bit_pos = 5 + (i % 8);
        SET_BIT(raw_value, i, GET_BIT(frame->data[byte_pos], bit_pos));
    }
    
    // 应用转换公式：物理值 = (原始值 × 1) + 0
    *value = (raw_value * 1) + 0;
    
    // 边界检查
    if (*value < 0 || *value > 3) {
        DBG_PRINT("信号AUDIO7_S_CLMWorkVoiceControl越界(值:%.2f, 范围:[%.2f~%.2f])", 
                 *value, 0, 3);
        return false;
    }
    
    DBG_PRINT("获取AUDIO7_S_CLMWorkVoiceControl成功: %.2f", *value);
    return true;
}

/*----------------------------------------------------------------*
 * 函数名：Set_AUDIO7_S_CLMWorkVoiceControl
 * 功能：设置空调关闭开关信号值
 * 参数：
 *   - frame: CAN帧指针
 *   - value: 输入信号值
 * 返回值：操作是否成功
 * 注意：空调关闭开关
 *----------------------------------------------------------------*/
bool Set_AUDIO7_S_CLMWorkVoiceControl(CAN_Frame* frame, float value) {
    // 边界检查
    if (value < 0 || value > 3) {
        DBG_PRINT("信号AUDIO7_S_CLMWorkVoiceControl越界(值:%.2f, 范围:[%.2f~%.2f])", 
                 value, 0, 3);
        return false;
    }
    
    // 计算原始值：原始值 = (物理值 - 0) / 1
    uint64_t raw_value = (uint64_t)round((value - 0) / 1);
    
    // 设置原始信号值
    // 大端模式处理
    for (int i = 0; i < 2; i++) {
        int byte_pos = 4 - (i / 8);
        int bit_pos = 5 + (i % 8);
        uint8_t bit_val = GET_BIT(raw_value, i);
        SET_BIT(frame->data[byte_pos], bit_pos, bit_val);
    }
    
    // 设置报文ID和长度
    frame->id = 0x347;
    frame->dlc = 8;
    
    DBG_PRINT("设置AUDIO7_S_CLMWorkVoiceControl成功: %.2f", value);
    return true;
}
/*----------------------------------------------------------------*
 * 函数名：Get_AUDIO7_S_SYNC
 * 功能：获取语音同步信号值
 * 参数：
 *   - frame: CAN帧指针
 *   - value: 输出信号值指针
 * 返回值：操作是否成功
 * 注意：语音同步
 *----------------------------------------------------------------*/
bool Get_AUDIO7_S_SYNC(const CAN_Frame* frame, float* value) {
    // 校验输入参数
    ERROR_TRAP(frame != NULL, "空指针异常");
    ERROR_TRAP(value != NULL, "输出参数无效");
    
    // 校验报文ID
    if (frame->id != 0x347) {
        DBG_PRINT("报文ID不匹配(预期:0x347, 实际:0x%X)", frame->id);
        return false;
    }
    
    // 提取原始信号值
    uint64_t raw_value = 0;
    // 大端模式处理
    for (int i = 0; i < 2; i++) {
        int byte_pos = 4 - (i / 8);
        int bit_pos = 7 + (i % 8);
        SET_BIT(raw_value, i, GET_BIT(frame->data[byte_pos], bit_pos));
    }
    
    // 应用转换公式：物理值 = (原始值 × 1) + 0
    *value = (raw_value * 1) + 0;
    
    // 边界检查
    if (*value < 0 || *value > 3) {
        DBG_PRINT("信号AUDIO7_S_SYNC越界(值:%.2f, 范围:[%.2f~%.2f])", 
                 *value, 0, 3);
        return false;
    }
    
    DBG_PRINT("获取AUDIO7_S_SYNC成功: %.2f", *value);
    return true;
}

/*----------------------------------------------------------------*
 * 函数名：Set_AUDIO7_S_SYNC
 * 功能：设置语音同步信号值
 * 参数：
 *   - frame: CAN帧指针
 *   - value: 输入信号值
 * 返回值：操作是否成功
 * 注意：语音同步
 *----------------------------------------------------------------*/
bool Set_AUDIO7_S_SYNC(CAN_Frame* frame, float value) {
    // 边界检查
    if (value < 0 || value > 3) {
        DBG_PRINT("信号AUDIO7_S_SYNC越界(值:%.2f, 范围:[%.2f~%.2f])", 
                 value, 0, 3);
        return false;
    }
    
    // 计算原始值：原始值 = (物理值 - 0) / 1
    uint64_t raw_value = (uint64_t)round((value - 0) / 1);
    
    // 设置原始信号值
    // 大端模式处理
    for (int i = 0; i < 2; i++) {
        int byte_pos = 4 - (i / 8);
        int bit_pos = 7 + (i % 8);
        uint8_t bit_val = GET_BIT(raw_value, i);
        SET_BIT(frame->data[byte_pos], bit_pos, bit_val);
    }
    
    // 设置报文ID和长度
    frame->id = 0x347;
    frame->dlc = 8;
    
    DBG_PRINT("设置AUDIO7_S_SYNC成功: %.2f", value);
    return true;
}
/*----------------------------------------------------------------*
 * 函数名：Get_AUDIO7_St_BlowerSpdSetVoiceControl
 * 功能：获取鼓风机转速调节信号值
 * 参数：
 *   - frame: CAN帧指针
 *   - value: 输出信号值指针
 * 返回值：操作是否成功
 * 注意：鼓风机转速调节
 *----------------------------------------------------------------*/
bool Get_AUDIO7_St_BlowerSpdSetVoiceControl(const CAN_Frame* frame, float* value) {
    // 校验输入参数
    ERROR_TRAP(frame != NULL, "空指针异常");
    ERROR_TRAP(value != NULL, "输出参数无效");
    
    // 校验报文ID
    if (frame->id != 0x347) {
        DBG_PRINT("报文ID不匹配(预期:0x347, 实际:0x%X)", frame->id);
        return false;
    }
    
    // 提取原始信号值
    uint64_t raw_value = 0;
    // 大端模式处理
    for (int i = 0; i < 4; i++) {
        int byte_pos = 5 - (i / 8);
        int bit_pos = 3 + (i % 8);
        SET_BIT(raw_value, i, GET_BIT(frame->data[byte_pos], bit_pos));
    }
    
    // 应用转换公式：物理值 = (原始值 × 1) + 0
    *value = (raw_value * 1) + 0;
    
    // 边界检查
    if (*value < 0 || *value > 15) {
        DBG_PRINT("信号AUDIO7_St_BlowerSpdSetVoiceControl越界(值:%.2f, 范围:[%.2f~%.2f])", 
                 *value, 0, 15);
        return false;
    }
    
    DBG_PRINT("获取AUDIO7_St_BlowerSpdSetVoiceControl成功: %.2f", *value);
    return true;
}

/*----------------------------------------------------------------*
 * 函数名：Set_AUDIO7_St_BlowerSpdSetVoiceControl
 * 功能：设置鼓风机转速调节信号值
 * 参数：
 *   - frame: CAN帧指针
 *   - value: 输入信号值
 * 返回值：操作是否成功
 * 注意：鼓风机转速调节
 *----------------------------------------------------------------*/
bool Set_AUDIO7_St_BlowerSpdSetVoiceControl(CAN_Frame* frame, float value) {
    // 边界检查
    if (value < 0 || value > 15) {
        DBG_PRINT("信号AUDIO7_St_BlowerSpdSetVoiceControl越界(值:%.2f, 范围:[%.2f~%.2f])", 
                 value, 0, 15);
        return false;
    }
    
    // 计算原始值：原始值 = (物理值 - 0) / 1
    uint64_t raw_value = (uint64_t)round((value - 0) / 1);
    
    // 设置原始信号值
    // 大端模式处理
    for (int i = 0; i < 4; i++) {
        int byte_pos = 5 - (i / 8);
        int bit_pos = 3 + (i % 8);
        uint8_t bit_val = GET_BIT(raw_value, i);
        SET_BIT(frame->data[byte_pos], bit_pos, bit_val);
    }
    
    // 设置报文ID和长度
    frame->id = 0x347;
    frame->dlc = 8;
    
    DBG_PRINT("设置AUDIO7_St_BlowerSpdSetVoiceControl成功: %.2f", value);
    return true;
}
/*----------------------------------------------------------------*
 * 函数名：Get_AUDIO7_S_RearDefrostVoiceControl
 * 功能：获取语音后除霜开关信号值
 * 参数：
 *   - frame: CAN帧指针
 *   - value: 输出信号值指针
 * 返回值：操作是否成功
 * 注意：语音后除霜开关
 *----------------------------------------------------------------*/
bool Get_AUDIO7_S_RearDefrostVoiceControl(const CAN_Frame* frame, float* value) {
    // 校验输入参数
    ERROR_TRAP(frame != NULL, "空指针异常");
    ERROR_TRAP(value != NULL, "输出参数无效");
    
    // 校验报文ID
    if (frame->id != 0x347) {
        DBG_PRINT("报文ID不匹配(预期:0x347, 实际:0x%X)", frame->id);
        return false;
    }
    
    // 提取原始信号值
    uint64_t raw_value = 0;
    // 大端模式处理
    for (int i = 0; i < 2; i++) {
        int byte_pos = 6 - (i / 8);
        int bit_pos = 1 + (i % 8);
        SET_BIT(raw_value, i, GET_BIT(frame->data[byte_pos], bit_pos));
    }
    
    // 应用转换公式：物理值 = (原始值 × 1) + 0
    *value = (raw_value * 1) + 0;
    
    // 边界检查
    if (*value < 0 || *value > 3) {
        DBG_PRINT("信号AUDIO7_S_RearDefrostVoiceControl越界(值:%.2f, 范围:[%.2f~%.2f])", 
                 *value, 0, 3);
        return false;
    }
    
    DBG_PRINT("获取AUDIO7_S_RearDefrostVoiceControl成功: %.2f", *value);
    return true;
}

/*----------------------------------------------------------------*
 * 函数名：Set_AUDIO7_S_RearDefrostVoiceControl
 * 功能：设置语音后除霜开关信号值
 * 参数：
 *   - frame: CAN帧指针
 *   - value: 输入信号值
 * 返回值：操作是否成功
 * 注意：语音后除霜开关
 *----------------------------------------------------------------*/
bool Set_AUDIO7_S_RearDefrostVoiceControl(CAN_Frame* frame, float value) {
    // 边界检查
    if (value < 0 || value > 3) {
        DBG_PRINT("信号AUDIO7_S_RearDefrostVoiceControl越界(值:%.2f, 范围:[%.2f~%.2f])", 
                 value, 0, 3);
        return false;
    }
    
    // 计算原始值：原始值 = (物理值 - 0) / 1
    uint64_t raw_value = (uint64_t)round((value - 0) / 1);
    
    // 设置原始信号值
    // 大端模式处理
    for (int i = 0; i < 2; i++) {
        int byte_pos = 6 - (i / 8);
        int bit_pos = 1 + (i % 8);
        uint8_t bit_val = GET_BIT(raw_value, i);
        SET_BIT(frame->data[byte_pos], bit_pos, bit_val);
    }
    
    // 设置报文ID和长度
    frame->id = 0x347;
    frame->dlc = 8;
    
    DBG_PRINT("设置AUDIO7_S_RearDefrostVoiceControl成功: %.2f", value);
    return true;
}
/*----------------------------------------------------------------*
 * 函数名：Get_AUDIO7_St_SetTempVoiceControl_R
 * 功能：获取温度设置_右侧电动空调不收、单温区不收(物理开关和大屏软开关平台化，按左右物理位置发送，不区分左右舵，不做镜像，单温区只发左侧开关)VM2预留信号值
 * 参数：
 *   - frame: CAN帧指针
 *   - value: 输出信号值指针
 * 返回值：操作是否成功
 * 注意：温度设置_右侧电动空调不收、单温区不收(物理开关和大屏软开关平台化，按左右物理位置发送，不区分左右舵，不做镜像，单温区只发左侧开关)VM2预留
 *----------------------------------------------------------------*/
bool Get_AUDIO7_St_SetTempVoiceControl_R(const CAN_Frame* frame, float* value) {
    // 校验输入参数
    ERROR_TRAP(frame != NULL, "空指针异常");
    ERROR_TRAP(value != NULL, "输出参数无效");
    
    // 校验报文ID
    if (frame->id != 0x347) {
        DBG_PRINT("报文ID不匹配(预期:0x347, 实际:0x%X)", frame->id);
        return false;
    }
    
    // 提取原始信号值
    uint64_t raw_value = 0;
    // 大端模式处理
    for (int i = 0; i < 5; i++) {
        int byte_pos = 6 - (i / 8);
        int bit_pos = 6 + (i % 8);
        SET_BIT(raw_value, i, GET_BIT(frame->data[byte_pos], bit_pos));
    }
    
    // 应用转换公式：物理值 = (原始值 × 0.5) + 18
    *value = (raw_value * 0.5) + 18;
    
    // 边界检查
    if (*value < 18 || *value > 32) {
        DBG_PRINT("信号AUDIO7_St_SetTempVoiceControl_R越界(值:%.2f, 范围:[%.2f~%.2f])", 
                 *value, 18, 32);
        return false;
    }
    
    DBG_PRINT("获取AUDIO7_St_SetTempVoiceControl_R成功: %.2f", *value);
    return true;
}

/*----------------------------------------------------------------*
 * 函数名：Set_AUDIO7_St_SetTempVoiceControl_R
 * 功能：设置温度设置_右侧电动空调不收、单温区不收(物理开关和大屏软开关平台化，按左右物理位置发送，不区分左右舵，不做镜像，单温区只发左侧开关)VM2预留信号值
 * 参数：
 *   - frame: CAN帧指针
 *   - value: 输入信号值
 * 返回值：操作是否成功
 * 注意：温度设置_右侧电动空调不收、单温区不收(物理开关和大屏软开关平台化，按左右物理位置发送，不区分左右舵，不做镜像，单温区只发左侧开关)VM2预留
 *----------------------------------------------------------------*/
bool Set_AUDIO7_St_SetTempVoiceControl_R(CAN_Frame* frame, float value) {
    // 边界检查
    if (value < 18 || value > 32) {
        DBG_PRINT("信号AUDIO7_St_SetTempVoiceControl_R越界(值:%.2f, 范围:[%.2f~%.2f])", 
                 value, 18, 32);
        return false;
    }
    
    // 计算原始值：原始值 = (物理值 - 18) / 0.5
    uint64_t raw_value = (uint64_t)round((value - 18) / 0.5);
    
    // 设置原始信号值
    // 大端模式处理
    for (int i = 0; i < 5; i++) {
        int byte_pos = 6 - (i / 8);
        int bit_pos = 6 + (i % 8);
        uint8_t bit_val = GET_BIT(raw_value, i);
        SET_BIT(frame->data[byte_pos], bit_pos, bit_val);
    }
    
    // 设置报文ID和长度
    frame->id = 0x347;
    frame->dlc = 8;
    
    DBG_PRINT("设置AUDIO7_St_SetTempVoiceControl_R成功: %.2f", value);
    return true;
}
/*----------------------------------------------------------------*
 * 函数名：Get_BCM1_St_ReverseGear
 * 功能：获取倒档MT和AT都需要发送(MT对应硬线，AT做信号映射)信号值
 * 参数：
 *   - frame: CAN帧指针
 *   - value: 输出信号值指针
 * 返回值：操作是否成功
 * 注意：倒档MT和AT都需要发送(MT对应硬线，AT做信号映射)
 *----------------------------------------------------------------*/
bool Get_BCM1_St_ReverseGear(const CAN_Frame* frame, float* value) {
    // 校验输入参数
    ERROR_TRAP(frame != NULL, "空指针异常");
    ERROR_TRAP(value != NULL, "输出参数无效");
    
    // 校验报文ID
    if (frame->id != 0x363) {
        DBG_PRINT("报文ID不匹配(预期:0x363, 实际:0x%X)", frame->id);
        return false;
    }
    
    // 提取原始信号值
    uint64_t raw_value = 0;
    // 大端模式处理
    for (int i = 0; i < 1; i++) {
        int byte_pos = 4 - (i / 8);
        int bit_pos = 4 + (i % 8);
        SET_BIT(raw_value, i, GET_BIT(frame->data[byte_pos], bit_pos));
    }
    
    // 应用转换公式：物理值 = (原始值 × 1) + 0
    *value = (raw_value * 1) + 0;
    
    // 边界检查
    if (*value < 0 || *value > 1) {
        DBG_PRINT("信号BCM1_St_ReverseGear越界(值:%.2f, 范围:[%.2f~%.2f])", 
                 *value, 0, 1);
        return false;
    }
    
    DBG_PRINT("获取BCM1_St_ReverseGear成功: %.2f", *value);
    return true;
}

/*----------------------------------------------------------------*
 * 函数名：Set_BCM1_St_ReverseGear
 * 功能：设置倒档MT和AT都需要发送(MT对应硬线，AT做信号映射)信号值
 * 参数：
 *   - frame: CAN帧指针
 *   - value: 输入信号值
 * 返回值：操作是否成功
 * 注意：倒档MT和AT都需要发送(MT对应硬线，AT做信号映射)
 *----------------------------------------------------------------*/
bool Set_BCM1_St_ReverseGear(CAN_Frame* frame, float value) {
    // 边界检查
    if (value < 0 || value > 1) {
        DBG_PRINT("信号BCM1_St_ReverseGear越界(值:%.2f, 范围:[%.2f~%.2f])", 
                 value, 0, 1);
        return false;
    }
    
    // 计算原始值：原始值 = (物理值 - 0) / 1
    uint64_t raw_value = (uint64_t)round((value - 0) / 1);
    
    // 设置原始信号值
    // 大端模式处理
    for (int i = 0; i < 1; i++) {
        int byte_pos = 4 - (i / 8);
        int bit_pos = 4 + (i % 8);
        uint8_t bit_val = GET_BIT(raw_value, i);
        SET_BIT(frame->data[byte_pos], bit_pos, bit_val);
    }
    
    // 设置报文ID和长度
    frame->id = 0x363;
    frame->dlc = 8;
    
    DBG_PRINT("设置BCM1_St_ReverseGear成功: %.2f", value);
    return true;
}
/*----------------------------------------------------------------*
 * 函数名：Get_BCM1_F_ReverseGear
 * 功能：获取倒档有效位MT和AT都需要发送(MT对应硬线，AT做信号映射)信号值
 * 参数：
 *   - frame: CAN帧指针
 *   - value: 输出信号值指针
 * 返回值：操作是否成功
 * 注意：倒档有效位MT和AT都需要发送(MT对应硬线，AT做信号映射)
 *----------------------------------------------------------------*/
bool Get_BCM1_F_ReverseGear(const CAN_Frame* frame, float* value) {
    // 校验输入参数
    ERROR_TRAP(frame != NULL, "空指针异常");
    ERROR_TRAP(value != NULL, "输出参数无效");
    
    // 校验报文ID
    if (frame->id != 0x363) {
        DBG_PRINT("报文ID不匹配(预期:0x363, 实际:0x%X)", frame->id);
        return false;
    }
    
    // 提取原始信号值
    uint64_t raw_value = 0;
    // 大端模式处理
    for (int i = 0; i < 1; i++) {
        int byte_pos = 4 - (i / 8);
        int bit_pos = 5 + (i % 8);
        SET_BIT(raw_value, i, GET_BIT(frame->data[byte_pos], bit_pos));
    }
    
    // 应用转换公式：物理值 = (原始值 × 1) + 0
    *value = (raw_value * 1) + 0;
    
    // 边界检查
    if (*value < 0 || *value > 1) {
        DBG_PRINT("信号BCM1_F_ReverseGear越界(值:%.2f, 范围:[%.2f~%.2f])", 
                 *value, 0, 1);
        return false;
    }
    
    DBG_PRINT("获取BCM1_F_ReverseGear成功: %.2f", *value);
    return true;
}

/*----------------------------------------------------------------*
 * 函数名：Set_BCM1_F_ReverseGear
 * 功能：设置倒档有效位MT和AT都需要发送(MT对应硬线，AT做信号映射)信号值
 * 参数：
 *   - frame: CAN帧指针
 *   - value: 输入信号值
 * 返回值：操作是否成功
 * 注意：倒档有效位MT和AT都需要发送(MT对应硬线，AT做信号映射)
 *----------------------------------------------------------------*/
bool Set_BCM1_F_ReverseGear(CAN_Frame* frame, float value) {
    // 边界检查
    if (value < 0 || value > 1) {
        DBG_PRINT("信号BCM1_F_ReverseGear越界(值:%.2f, 范围:[%.2f~%.2f])", 
                 value, 0, 1);
        return false;
    }
    
    // 计算原始值：原始值 = (物理值 - 0) / 1
    uint64_t raw_value = (uint64_t)round((value - 0) / 1);
    
    // 设置原始信号值
    // 大端模式处理
    for (int i = 0; i < 1; i++) {
        int byte_pos = 4 - (i / 8);
        int bit_pos = 5 + (i % 8);
        uint8_t bit_val = GET_BIT(raw_value, i);
        SET_BIT(frame->data[byte_pos], bit_pos, bit_val);
    }
    
    // 设置报文ID和长度
    frame->id = 0x363;
    frame->dlc = 8;
    
    DBG_PRINT("设置BCM1_F_ReverseGear成功: %.2f", value);
    return true;
}
/*----------------------------------------------------------------*
 * 函数名：Get_BCM1_N_PM25Value
 * 功能：获取PM2.5浓度（电动空调不发）信号值
 * 参数：
 *   - frame: CAN帧指针
 *   - value: 输出信号值指针
 * 返回值：操作是否成功
 * 注意：PM2.5浓度（电动空调不发）
 *----------------------------------------------------------------*/
bool Get_BCM1_N_PM25Value(const CAN_Frame* frame, float* value) {
    // 校验输入参数
    ERROR_TRAP(frame != NULL, "空指针异常");
    ERROR_TRAP(value != NULL, "输出参数无效");
    
    // 校验报文ID
    if (frame->id != 0x363) {
        DBG_PRINT("报文ID不匹配(预期:0x363, 实际:0x%X)", frame->id);
        return false;
    }
    
    // 提取原始信号值
    uint64_t raw_value = 0;
    // 大端模式处理
    for (int i = 0; i < 10; i++) {
        int byte_pos = 6 - (i / 8);
        int bit_pos = 1 + (i % 8);
        SET_BIT(raw_value, i, GET_BIT(frame->data[byte_pos], bit_pos));
    }
    
    // 应用转换公式：物理值 = (原始值 × 1) + 0
    *value = (raw_value * 1) + 0;
    
    // 边界检查
    if (*value < 0 || *value > 999) {
        DBG_PRINT("信号BCM1_N_PM25Value越界(值:%.2f, 范围:[%.2f~%.2f])", 
                 *value, 0, 999);
        return false;
    }
    
    DBG_PRINT("获取BCM1_N_PM25Value成功: %.2fug/m^3", *value);
    return true;
}

/*----------------------------------------------------------------*
 * 函数名：Set_BCM1_N_PM25Value
 * 功能：设置PM2.5浓度（电动空调不发）信号值
 * 参数：
 *   - frame: CAN帧指针
 *   - value: 输入信号值
 * 返回值：操作是否成功
 * 注意：PM2.5浓度（电动空调不发）
 *----------------------------------------------------------------*/
bool Set_BCM1_N_PM25Value(CAN_Frame* frame, float value) {
    // 边界检查
    if (value < 0 || value > 999) {
        DBG_PRINT("信号BCM1_N_PM25Value越界(值:%.2f, 范围:[%.2f~%.2f])", 
                 value, 0, 999);
        return false;
    }
    
    // 计算原始值：原始值 = (物理值 - 0) / 1
    uint64_t raw_value = (uint64_t)round((value - 0) / 1);
    
    // 设置原始信号值
    // 大端模式处理
    for (int i = 0; i < 10; i++) {
        int byte_pos = 6 - (i / 8);
        int bit_pos = 1 + (i % 8);
        uint8_t bit_val = GET_BIT(raw_value, i);
        SET_BIT(frame->data[byte_pos], bit_pos, bit_val);
    }
    
    // 设置报文ID和长度
    frame->id = 0x363;
    frame->dlc = 8;
    
    DBG_PRINT("设置BCM1_N_PM25Value成功: %.2fug/m^3", value);
    return true;
}
/*----------------------------------------------------------------*
 * 函数名：Get_AC1_Checksum
 * 功能：获取Checksum信号值
 * 参数：
 *   - frame: CAN帧指针
 *   - value: 输出信号值指针
 * 返回值：操作是否成功
 * 注意：Checksum
 *----------------------------------------------------------------*/
bool Get_AC1_Checksum(const CAN_Frame* frame, float* value) {
    // 校验输入参数
    ERROR_TRAP(frame != NULL, "空指针异常");
    ERROR_TRAP(value != NULL, "输出参数无效");
    
    // 校验报文ID
    if (frame->id != 0x36C) {
        DBG_PRINT("报文ID不匹配(预期:0x36C, 实际:0x%X)", frame->id);
        return false;
    }
    
    // 提取原始信号值
    uint64_t raw_value = 0;
    // 大端模式处理
    for (int i = 0; i < 8; i++) {
        int byte_pos = 0 - (i / 8);
        int bit_pos = 7 + (i % 8);
        SET_BIT(raw_value, i, GET_BIT(frame->data[byte_pos], bit_pos));
    }
    
    // 应用转换公式：物理值 = (原始值 × 1) + 0
    *value = (raw_value * 1) + 0;
    
    // 边界检查
    if (*value < 0 || *value > 255) {
        DBG_PRINT("信号AC1_Checksum越界(值:%.2f, 范围:[%.2f~%.2f])", 
                 *value, 0, 255);
        return false;
    }
    
    DBG_PRINT("获取AC1_Checksum成功: %.2f", *value);
    return true;
}

/*----------------------------------------------------------------*
 * 函数名：Set_AC1_Checksum
 * 功能：设置Checksum信号值
 * 参数：
 *   - frame: CAN帧指针
 *   - value: 输入信号值
 * 返回值：操作是否成功
 * 注意：Checksum
 *----------------------------------------------------------------*/
bool Set_AC1_Checksum(CAN_Frame* frame, float value) {
    // 边界检查
    if (value < 0 || value > 255) {
        DBG_PRINT("信号AC1_Checksum越界(值:%.2f, 范围:[%.2f~%.2f])", 
                 value, 0, 255);
        return false;
    }
    
    // 计算原始值：原始值 = (物理值 - 0) / 1
    uint64_t raw_value = (uint64_t)round((value - 0) / 1);
    
    // 设置原始信号值
    // 大端模式处理
    for (int i = 0; i < 8; i++) {
        int byte_pos = 0 - (i / 8);
        int bit_pos = 7 + (i % 8);
        uint8_t bit_val = GET_BIT(raw_value, i);
        SET_BIT(frame->data[byte_pos], bit_pos, bit_val);
    }
    
    // 设置报文ID和长度
    frame->id = 0x36C;
    frame->dlc = 8;
    
    DBG_PRINT("设置AC1_Checksum成功: %.2f", value);
    return true;
}
/*----------------------------------------------------------------*
 * 函数名：Get_AC1_S_AC
 * 功能：获取AC开关状态信号值
 * 参数：
 *   - frame: CAN帧指针
 *   - value: 输出信号值指针
 * 返回值：操作是否成功
 * 注意：AC开关状态
 *----------------------------------------------------------------*/
bool Get_AC1_S_AC(const CAN_Frame* frame, float* value) {
    // 校验输入参数
    ERROR_TRAP(frame != NULL, "空指针异常");
    ERROR_TRAP(value != NULL, "输出参数无效");
    
    // 校验报文ID
    if (frame->id != 0x36C) {
        DBG_PRINT("报文ID不匹配(预期:0x36C, 实际:0x%X)", frame->id);
        return false;
    }
    
    // 提取原始信号值
    uint64_t raw_value = 0;
    // 大端模式处理
    for (int i = 0; i < 1; i++) {
        int byte_pos = 1 - (i / 8);
        int bit_pos = 7 + (i % 8);
        SET_BIT(raw_value, i, GET_BIT(frame->data[byte_pos], bit_pos));
    }
    
    // 应用转换公式：物理值 = (原始值 × 1) + 0
    *value = (raw_value * 1) + 0;
    
    // 边界检查
    if (*value < 0 || *value > 1) {
        DBG_PRINT("信号AC1_S_AC越界(值:%.2f, 范围:[%.2f~%.2f])", 
                 *value, 0, 1);
        return false;
    }
    
    DBG_PRINT("获取AC1_S_AC成功: %.2f", *value);
    return true;
}

/*----------------------------------------------------------------*
 * 函数名：Set_AC1_S_AC
 * 功能：设置AC开关状态信号值
 * 参数：
 *   - frame: CAN帧指针
 *   - value: 输入信号值
 * 返回值：操作是否成功
 * 注意：AC开关状态
 *----------------------------------------------------------------*/
bool Set_AC1_S_AC(CAN_Frame* frame, float value) {
    // 边界检查
    if (value < 0 || value > 1) {
        DBG_PRINT("信号AC1_S_AC越界(值:%.2f, 范围:[%.2f~%.2f])", 
                 value, 0, 1);
        return false;
    }
    
    // 计算原始值：原始值 = (物理值 - 0) / 1
    uint64_t raw_value = (uint64_t)round((value - 0) / 1);
    
    // 设置原始信号值
    // 大端模式处理
    for (int i = 0; i < 1; i++) {
        int byte_pos = 1 - (i / 8);
        int bit_pos = 7 + (i % 8);
        uint8_t bit_val = GET_BIT(raw_value, i);
        SET_BIT(frame->data[byte_pos], bit_pos, bit_val);
    }
    
    // 设置报文ID和长度
    frame->id = 0x36C;
    frame->dlc = 8;
    
    DBG_PRINT("设置AC1_S_AC成功: %.2f", value);
    return true;
}
/*----------------------------------------------------------------*
 * 函数名：Get_AC1_St_Blower
 * 功能：获取风机档位信号值
 * 参数：
 *   - frame: CAN帧指针
 *   - value: 输出信号值指针
 * 返回值：操作是否成功
 * 注意：风机档位
 *----------------------------------------------------------------*/
bool Get_AC1_St_Blower(const CAN_Frame* frame, float* value) {
    // 校验输入参数
    ERROR_TRAP(frame != NULL, "空指针异常");
    ERROR_TRAP(value != NULL, "输出参数无效");
    
    // 校验报文ID
    if (frame->id != 0x36C) {
        DBG_PRINT("报文ID不匹配(预期:0x36C, 实际:0x%X)", frame->id);
        return false;
    }
    
    // 提取原始信号值
    uint64_t raw_value = 0;
    // 大端模式处理
    for (int i = 0; i < 4; i++) {
        int byte_pos = 4 - (i / 8);
        int bit_pos = 3 + (i % 8);
        SET_BIT(raw_value, i, GET_BIT(frame->data[byte_pos], bit_pos));
    }
    
    // 应用转换公式：物理值 = (原始值 × 1) + 0
    *value = (raw_value * 1) + 0;
    
    // 边界检查
    if (*value < 0 || *value > 15) {
        DBG_PRINT("信号AC1_St_Blower越界(值:%.2f, 范围:[%.2f~%.2f])", 
                 *value, 0, 15);
        return false;
    }
    
    DBG_PRINT("获取AC1_St_Blower成功: %.2f", *value);
    return true;
}

/*----------------------------------------------------------------*
 * 函数名：Set_AC1_St_Blower
 * 功能：设置风机档位信号值
 * 参数：
 *   - frame: CAN帧指针
 *   - value: 输入信号值
 * 返回值：操作是否成功
 * 注意：风机档位
 *----------------------------------------------------------------*/
bool Set_AC1_St_Blower(CAN_Frame* frame, float value) {
    // 边界检查
    if (value < 0 || value > 15) {
        DBG_PRINT("信号AC1_St_Blower越界(值:%.2f, 范围:[%.2f~%.2f])", 
                 value, 0, 15);
        return false;
    }
    
    // 计算原始值：原始值 = (物理值 - 0) / 1
    uint64_t raw_value = (uint64_t)round((value - 0) / 1);
    
    // 设置原始信号值
    // 大端模式处理
    for (int i = 0; i < 4; i++) {
        int byte_pos = 4 - (i / 8);
        int bit_pos = 3 + (i % 8);
        uint8_t bit_val = GET_BIT(raw_value, i);
        SET_BIT(frame->data[byte_pos], bit_pos, bit_val);
    }
    
    // 设置报文ID和长度
    frame->id = 0x36C;
    frame->dlc = 8;
    
    DBG_PRINT("设置AC1_St_Blower成功: %.2f", value);
    return true;
}
/*----------------------------------------------------------------*
 * 函数名：Get_AC1_H_L_PRESS_Sta
 * 功能：获取高低压力开关状态信号值
 * 参数：
 *   - frame: CAN帧指针
 *   - value: 输出信号值指针
 * 返回值：操作是否成功
 * 注意：高低压力开关状态
 *----------------------------------------------------------------*/
bool Get_AC1_H_L_PRESS_Sta(const CAN_Frame* frame, float* value) {
    // 校验输入参数
    ERROR_TRAP(frame != NULL, "空指针异常");
    ERROR_TRAP(value != NULL, "输出参数无效");
    
    // 校验报文ID
    if (frame->id != 0x36C) {
        DBG_PRINT("报文ID不匹配(预期:0x36C, 实际:0x%X)", frame->id);
        return false;
    }
    
    // 提取原始信号值
    uint64_t raw_value = 0;
    // 大端模式处理
    for (int i = 0; i < 2; i++) {
        int byte_pos = 5 - (i / 8);
        int bit_pos = 1 + (i % 8);
        SET_BIT(raw_value, i, GET_BIT(frame->data[byte_pos], bit_pos));
    }
    
    // 应用转换公式：物理值 = (原始值 × 1) + 0
    *value = (raw_value * 1) + 0;
    
    // 边界检查
    if (*value < 0 || *value > 3) {
        DBG_PRINT("信号AC1_H_L_PRESS_Sta越界(值:%.2f, 范围:[%.2f~%.2f])", 
                 *value, 0, 3);
        return false;
    }
    
    DBG_PRINT("获取AC1_H_L_PRESS_Sta成功: %.2f", *value);
    return true;
}

/*----------------------------------------------------------------*
 * 函数名：Set_AC1_H_L_PRESS_Sta
 * 功能：设置高低压力开关状态信号值
 * 参数：
 *   - frame: CAN帧指针
 *   - value: 输入信号值
 * 返回值：操作是否成功
 * 注意：高低压力开关状态
 *----------------------------------------------------------------*/
bool Set_AC1_H_L_PRESS_Sta(CAN_Frame* frame, float value) {
    // 边界检查
    if (value < 0 || value > 3) {
        DBG_PRINT("信号AC1_H_L_PRESS_Sta越界(值:%.2f, 范围:[%.2f~%.2f])", 
                 value, 0, 3);
        return false;
    }
    
    // 计算原始值：原始值 = (物理值 - 0) / 1
    uint64_t raw_value = (uint64_t)round((value - 0) / 1);
    
    // 设置原始信号值
    // 大端模式处理
    for (int i = 0; i < 2; i++) {
        int byte_pos = 5 - (i / 8);
        int bit_pos = 1 + (i % 8);
        uint8_t bit_val = GET_BIT(raw_value, i);
        SET_BIT(frame->data[byte_pos], bit_pos, bit_val);
    }
    
    // 设置报文ID和长度
    frame->id = 0x36C;
    frame->dlc = 8;
    
    DBG_PRINT("设置AC1_H_L_PRESS_Sta成功: %.2f", value);
    return true;
}
/*----------------------------------------------------------------*
 * 函数名：Get_AC1_St_AirCirculate
 * 功能：获取循环风门信号值
 * 参数：
 *   - frame: CAN帧指针
 *   - value: 输出信号值指针
 * 返回值：操作是否成功
 * 注意：循环风门
 *----------------------------------------------------------------*/
bool Get_AC1_St_AirCirculate(const CAN_Frame* frame, float* value) {
    // 校验输入参数
    ERROR_TRAP(frame != NULL, "空指针异常");
    ERROR_TRAP(value != NULL, "输出参数无效");
    
    // 校验报文ID
    if (frame->id != 0x36C) {
        DBG_PRINT("报文ID不匹配(预期:0x36C, 实际:0x%X)", frame->id);
        return false;
    }
    
    // 提取原始信号值
    uint64_t raw_value = 0;
    // 大端模式处理
    for (int i = 0; i < 2; i++) {
        int byte_pos = 6 - (i / 8);
        int bit_pos = 4 + (i % 8);
        SET_BIT(raw_value, i, GET_BIT(frame->data[byte_pos], bit_pos));
    }
    
    // 应用转换公式：物理值 = (原始值 × 1) + 0
    *value = (raw_value * 1) + 0;
    
    // 边界检查
    if (*value < 0 || *value > 3) {
        DBG_PRINT("信号AC1_St_AirCirculate越界(值:%.2f, 范围:[%.2f~%.2f])", 
                 *value, 0, 3);
        return false;
    }
    
    DBG_PRINT("获取AC1_St_AirCirculate成功: %.2f", *value);
    return true;
}

/*----------------------------------------------------------------*
 * 函数名：Set_AC1_St_AirCirculate
 * 功能：设置循环风门信号值
 * 参数：
 *   - frame: CAN帧指针
 *   - value: 输入信号值
 * 返回值：操作是否成功
 * 注意：循环风门
 *----------------------------------------------------------------*/
bool Set_AC1_St_AirCirculate(CAN_Frame* frame, float value) {
    // 边界检查
    if (value < 0 || value > 3) {
        DBG_PRINT("信号AC1_St_AirCirculate越界(值:%.2f, 范围:[%.2f~%.2f])", 
                 value, 0, 3);
        return false;
    }
    
    // 计算原始值：原始值 = (物理值 - 0) / 1
    uint64_t raw_value = (uint64_t)round((value - 0) / 1);
    
    // 设置原始信号值
    // 大端模式处理
    for (int i = 0; i < 2; i++) {
        int byte_pos = 6 - (i / 8);
        int bit_pos = 4 + (i % 8);
        uint8_t bit_val = GET_BIT(raw_value, i);
        SET_BIT(frame->data[byte_pos], bit_pos, bit_val);
    }
    
    // 设置报文ID和长度
    frame->id = 0x36C;
    frame->dlc = 8;
    
    DBG_PRINT("设置AC1_St_AirCirculate成功: %.2f", value);
    return true;
}
/*----------------------------------------------------------------*
 * 函数名：Get_AC1_MID_PRESS_Status
 * 功能：获取中压压力开关状态信号值
 * 参数：
 *   - frame: CAN帧指针
 *   - value: 输出信号值指针
 * 返回值：操作是否成功
 * 注意：中压压力开关状态
 *----------------------------------------------------------------*/
bool Get_AC1_MID_PRESS_Status(const CAN_Frame* frame, float* value) {
    // 校验输入参数
    ERROR_TRAP(frame != NULL, "空指针异常");
    ERROR_TRAP(value != NULL, "输出参数无效");
    
    // 校验报文ID
    if (frame->id != 0x36C) {
        DBG_PRINT("报文ID不匹配(预期:0x36C, 实际:0x%X)", frame->id);
        return false;
    }
    
    // 提取原始信号值
    uint64_t raw_value = 0;
    // 大端模式处理
    for (int i = 0; i < 1; i++) {
        int byte_pos = 6 - (i / 8);
        int bit_pos = 7 + (i % 8);
        SET_BIT(raw_value, i, GET_BIT(frame->data[byte_pos], bit_pos));
    }
    
    // 应用转换公式：物理值 = (原始值 × 1) + 0
    *value = (raw_value * 1) + 0;
    
    // 边界检查
    if (*value < 0 || *value > 1) {
        DBG_PRINT("信号AC1_MID_PRESS_Status越界(值:%.2f, 范围:[%.2f~%.2f])", 
                 *value, 0, 1);
        return false;
    }
    
    DBG_PRINT("获取AC1_MID_PRESS_Status成功: %.2f", *value);
    return true;
}

/*----------------------------------------------------------------*
 * 函数名：Set_AC1_MID_PRESS_Status
 * 功能：设置中压压力开关状态信号值
 * 参数：
 *   - frame: CAN帧指针
 *   - value: 输入信号值
 * 返回值：操作是否成功
 * 注意：中压压力开关状态
 *----------------------------------------------------------------*/
bool Set_AC1_MID_PRESS_Status(CAN_Frame* frame, float value) {
    // 边界检查
    if (value < 0 || value > 1) {
        DBG_PRINT("信号AC1_MID_PRESS_Status越界(值:%.2f, 范围:[%.2f~%.2f])", 
                 value, 0, 1);
        return false;
    }
    
    // 计算原始值：原始值 = (物理值 - 0) / 1
    uint64_t raw_value = (uint64_t)round((value - 0) / 1);
    
    // 设置原始信号值
    // 大端模式处理
    for (int i = 0; i < 1; i++) {
        int byte_pos = 6 - (i / 8);
        int bit_pos = 7 + (i % 8);
        uint8_t bit_val = GET_BIT(raw_value, i);
        SET_BIT(frame->data[byte_pos], bit_pos, bit_val);
    }
    
    // 设置报文ID和长度
    frame->id = 0x36C;
    frame->dlc = 8;
    
    DBG_PRINT("设置AC1_MID_PRESS_Status成功: %.2f", value);
    return true;
}
/*----------------------------------------------------------------*
 * 函数名：Get_AC1_St_FlowMode
 * 功能：获取模式风门信号值
 * 参数：
 *   - frame: CAN帧指针
 *   - value: 输出信号值指针
 * 返回值：操作是否成功
 * 注意：模式风门
 *----------------------------------------------------------------*/
bool Get_AC1_St_FlowMode(const CAN_Frame* frame, float* value) {
    // 校验输入参数
    ERROR_TRAP(frame != NULL, "空指针异常");
    ERROR_TRAP(value != NULL, "输出参数无效");
    
    // 校验报文ID
    if (frame->id != 0x36C) {
        DBG_PRINT("报文ID不匹配(预期:0x36C, 实际:0x%X)", frame->id);
        return false;
    }
    
    // 提取原始信号值
    uint64_t raw_value = 0;
    // 大端模式处理
    for (int i = 0; i < 3; i++) {
        int byte_pos = 7 - (i / 8);
        int bit_pos = 2 + (i % 8);
        SET_BIT(raw_value, i, GET_BIT(frame->data[byte_pos], bit_pos));
    }
    
    // 应用转换公式：物理值 = (原始值 × 1) + 0
    *value = (raw_value * 1) + 0;
    
    // 边界检查
    if (*value < 0 || *value > 7) {
        DBG_PRINT("信号AC1_St_FlowMode越界(值:%.2f, 范围:[%.2f~%.2f])", 
                 *value, 0, 7);
        return false;
    }
    
    DBG_PRINT("获取AC1_St_FlowMode成功: %.2f", *value);
    return true;
}

/*----------------------------------------------------------------*
 * 函数名：Set_AC1_St_FlowMode
 * 功能：设置模式风门信号值
 * 参数：
 *   - frame: CAN帧指针
 *   - value: 输入信号值
 * 返回值：操作是否成功
 * 注意：模式风门
 *----------------------------------------------------------------*/
bool Set_AC1_St_FlowMode(CAN_Frame* frame, float value) {
    // 边界检查
    if (value < 0 || value > 7) {
        DBG_PRINT("信号AC1_St_FlowMode越界(值:%.2f, 范围:[%.2f~%.2f])", 
                 value, 0, 7);
        return false;
    }
    
    // 计算原始值：原始值 = (物理值 - 0) / 1
    uint64_t raw_value = (uint64_t)round((value - 0) / 1);
    
    // 设置原始信号值
    // 大端模式处理
    for (int i = 0; i < 3; i++) {
        int byte_pos = 7 - (i / 8);
        int bit_pos = 2 + (i % 8);
        uint8_t bit_val = GET_BIT(raw_value, i);
        SET_BIT(frame->data[byte_pos], bit_pos, bit_val);
    }
    
    // 设置报文ID和长度
    frame->id = 0x36C;
    frame->dlc = 8;
    
    DBG_PRINT("设置AC1_St_FlowMode成功: %.2f", value);
    return true;
}
/*----------------------------------------------------------------*
 * 函数名：Get_AUDIO4_S_PM25AirClean
 * 功能：获取AUDIO4_S_PM25AirClean信号值
 * 参数：
 *   - frame: CAN帧指针
 *   - value: 输出信号值指针
 * 返回值：操作是否成功
 * 注意：无特殊说明
 *----------------------------------------------------------------*/
bool Get_AUDIO4_S_PM25AirClean(const CAN_Frame* frame, float* value) {
    // 校验输入参数
    ERROR_TRAP(frame != NULL, "空指针异常");
    ERROR_TRAP(value != NULL, "输出参数无效");
    
    // 校验报文ID
    if (frame->id != 0x374) {
        DBG_PRINT("报文ID不匹配(预期:0x374, 实际:0x%X)", frame->id);
        return false;
    }
    
    // 提取原始信号值
    uint64_t raw_value = 0;
    // 大端模式处理
    for (int i = 0; i < 2; i++) {
        int byte_pos = 1 - (i / 8);
        int bit_pos = 5 + (i % 8);
        SET_BIT(raw_value, i, GET_BIT(frame->data[byte_pos], bit_pos));
    }
    
    // 应用转换公式：物理值 = (原始值 × 1) + 0
    *value = (raw_value * 1) + 0;
    
    // 边界检查
    if (*value < 0 || *value > 3) {
        DBG_PRINT("信号AUDIO4_S_PM25AirClean越界(值:%.2f, 范围:[%.2f~%.2f])", 
                 *value, 0, 3);
        return false;
    }
    
    DBG_PRINT("获取AUDIO4_S_PM25AirClean成功: %.2f", *value);
    return true;
}

/*----------------------------------------------------------------*
 * 函数名：Set_AUDIO4_S_PM25AirClean
 * 功能：设置AUDIO4_S_PM25AirClean信号值
 * 参数：
 *   - frame: CAN帧指针
 *   - value: 输入信号值
 * 返回值：操作是否成功
 * 注意：无特殊说明
 *----------------------------------------------------------------*/
bool Set_AUDIO4_S_PM25AirClean(CAN_Frame* frame, float value) {
    // 边界检查
    if (value < 0 || value > 3) {
        DBG_PRINT("信号AUDIO4_S_PM25AirClean越界(值:%.2f, 范围:[%.2f~%.2f])", 
                 value, 0, 3);
        return false;
    }
    
    // 计算原始值：原始值 = (物理值 - 0) / 1
    uint64_t raw_value = (uint64_t)round((value - 0) / 1);
    
    // 设置原始信号值
    // 大端模式处理
    for (int i = 0; i < 2; i++) {
        int byte_pos = 1 - (i / 8);
        int bit_pos = 5 + (i % 8);
        uint8_t bit_val = GET_BIT(raw_value, i);
        SET_BIT(frame->data[byte_pos], bit_pos, bit_val);
    }
    
    // 设置报文ID和长度
    frame->id = 0x374;
    frame->dlc = 8;
    
    DBG_PRINT("设置AUDIO4_S_PM25AirClean成功: %.2f", value);
    return true;
}
/*----------------------------------------------------------------*
 * 函数名：Get_AUDIO4_S_SetTempDown_R
 * 功能：获取温度下降按下按钮发1（发三次），松开后发0，区别长短按，长按一直发0VM2预留信号值
 * 参数：
 *   - frame: CAN帧指针
 *   - value: 输出信号值指针
 * 返回值：操作是否成功
 * 注意：温度下降按下按钮发1（发三次），松开后发0，区别长短按，长按一直发0VM2预留
 *----------------------------------------------------------------*/
bool Get_AUDIO4_S_SetTempDown_R(const CAN_Frame* frame, float* value) {
    // 校验输入参数
    ERROR_TRAP(frame != NULL, "空指针异常");
    ERROR_TRAP(value != NULL, "输出参数无效");
    
    // 校验报文ID
    if (frame->id != 0x374) {
        DBG_PRINT("报文ID不匹配(预期:0x374, 实际:0x%X)", frame->id);
        return false;
    }
    
    // 提取原始信号值
    uint64_t raw_value = 0;
    // 大端模式处理
    for (int i = 0; i < 1; i++) {
        int byte_pos = 1 - (i / 8);
        int bit_pos = 7 + (i % 8);
        SET_BIT(raw_value, i, GET_BIT(frame->data[byte_pos], bit_pos));
    }
    
    // 应用转换公式：物理值 = (原始值 × 1) + 0
    *value = (raw_value * 1) + 0;
    
    // 边界检查
    if (*value < 0 || *value > 1) {
        DBG_PRINT("信号AUDIO4_S_SetTempDown_R越界(值:%.2f, 范围:[%.2f~%.2f])", 
                 *value, 0, 1);
        return false;
    }
    
    DBG_PRINT("获取AUDIO4_S_SetTempDown_R成功: %.2f", *value);
    return true;
}

/*----------------------------------------------------------------*
 * 函数名：Set_AUDIO4_S_SetTempDown_R
 * 功能：设置温度下降按下按钮发1（发三次），松开后发0，区别长短按，长按一直发0VM2预留信号值
 * 参数：
 *   - frame: CAN帧指针
 *   - value: 输入信号值
 * 返回值：操作是否成功
 * 注意：温度下降按下按钮发1（发三次），松开后发0，区别长短按，长按一直发0VM2预留
 *----------------------------------------------------------------*/
bool Set_AUDIO4_S_SetTempDown_R(CAN_Frame* frame, float value) {
    // 边界检查
    if (value < 0 || value > 1) {
        DBG_PRINT("信号AUDIO4_S_SetTempDown_R越界(值:%.2f, 范围:[%.2f~%.2f])", 
                 value, 0, 1);
        return false;
    }
    
    // 计算原始值：原始值 = (物理值 - 0) / 1
    uint64_t raw_value = (uint64_t)round((value - 0) / 1);
    
    // 设置原始信号值
    // 大端模式处理
    for (int i = 0; i < 1; i++) {
        int byte_pos = 1 - (i / 8);
        int bit_pos = 7 + (i % 8);
        uint8_t bit_val = GET_BIT(raw_value, i);
        SET_BIT(frame->data[byte_pos], bit_pos, bit_val);
    }
    
    // 设置报文ID和长度
    frame->id = 0x374;
    frame->dlc = 8;
    
    DBG_PRINT("设置AUDIO4_S_SetTempDown_R成功: %.2f", value);
    return true;
}
/*----------------------------------------------------------------*
 * 函数名：Get_AUDIO4_S_SetTempUp_L
 * 功能：获取温度上升按下按钮发1（发三次），松开后发0，区别长短按，长按一直发0信号值
 * 参数：
 *   - frame: CAN帧指针
 *   - value: 输出信号值指针
 * 返回值：操作是否成功
 * 注意：温度上升按下按钮发1（发三次），松开后发0，区别长短按，长按一直发0
 *----------------------------------------------------------------*/
bool Get_AUDIO4_S_SetTempUp_L(const CAN_Frame* frame, float* value) {
    // 校验输入参数
    ERROR_TRAP(frame != NULL, "空指针异常");
    ERROR_TRAP(value != NULL, "输出参数无效");
    
    // 校验报文ID
    if (frame->id != 0x374) {
        DBG_PRINT("报文ID不匹配(预期:0x374, 实际:0x%X)", frame->id);
        return false;
    }
    
    // 提取原始信号值
    uint64_t raw_value = 0;
    // 大端模式处理
    for (int i = 0; i < 1; i++) {
        int byte_pos = 2 - (i / 8);
        int bit_pos = 0 + (i % 8);
        SET_BIT(raw_value, i, GET_BIT(frame->data[byte_pos], bit_pos));
    }
    
    // 应用转换公式：物理值 = (原始值 × 1) + 0
    *value = (raw_value * 1) + 0;
    
    // 边界检查
    if (*value < 0 || *value > 1) {
        DBG_PRINT("信号AUDIO4_S_SetTempUp_L越界(值:%.2f, 范围:[%.2f~%.2f])", 
                 *value, 0, 1);
        return false;
    }
    
    DBG_PRINT("获取AUDIO4_S_SetTempUp_L成功: %.2f", *value);
    return true;
}

/*----------------------------------------------------------------*
 * 函数名：Set_AUDIO4_S_SetTempUp_L
 * 功能：设置温度上升按下按钮发1（发三次），松开后发0，区别长短按，长按一直发0信号值
 * 参数：
 *   - frame: CAN帧指针
 *   - value: 输入信号值
 * 返回值：操作是否成功
 * 注意：温度上升按下按钮发1（发三次），松开后发0，区别长短按，长按一直发0
 *----------------------------------------------------------------*/
bool Set_AUDIO4_S_SetTempUp_L(CAN_Frame* frame, float value) {
    // 边界检查
    if (value < 0 || value > 1) {
        DBG_PRINT("信号AUDIO4_S_SetTempUp_L越界(值:%.2f, 范围:[%.2f~%.2f])", 
                 value, 0, 1);
        return false;
    }
    
    // 计算原始值：原始值 = (物理值 - 0) / 1
    uint64_t raw_value = (uint64_t)round((value - 0) / 1);
    
    // 设置原始信号值
    // 大端模式处理
    for (int i = 0; i < 1; i++) {
        int byte_pos = 2 - (i / 8);
        int bit_pos = 0 + (i % 8);
        uint8_t bit_val = GET_BIT(raw_value, i);
        SET_BIT(frame->data[byte_pos], bit_pos, bit_val);
    }
    
    // 设置报文ID和长度
    frame->id = 0x374;
    frame->dlc = 8;
    
    DBG_PRINT("设置AUDIO4_S_SetTempUp_L成功: %.2f", value);
    return true;
}
/*----------------------------------------------------------------*
 * 函数名：Get_AUDIO4_S_SetTempDown_L
 * 功能：获取温度下降按下按钮发1（发三次），松开后发0，区别长短按，长按一直发0信号值
 * 参数：
 *   - frame: CAN帧指针
 *   - value: 输出信号值指针
 * 返回值：操作是否成功
 * 注意：温度下降按下按钮发1（发三次），松开后发0，区别长短按，长按一直发0
 *----------------------------------------------------------------*/
bool Get_AUDIO4_S_SetTempDown_L(const CAN_Frame* frame, float* value) {
    // 校验输入参数
    ERROR_TRAP(frame != NULL, "空指针异常");
    ERROR_TRAP(value != NULL, "输出参数无效");
    
    // 校验报文ID
    if (frame->id != 0x374) {
        DBG_PRINT("报文ID不匹配(预期:0x374, 实际:0x%X)", frame->id);
        return false;
    }
    
    // 提取原始信号值
    uint64_t raw_value = 0;
    // 大端模式处理
    for (int i = 0; i < 1; i++) {
        int byte_pos = 2 - (i / 8);
        int bit_pos = 1 + (i % 8);
        SET_BIT(raw_value, i, GET_BIT(frame->data[byte_pos], bit_pos));
    }
    
    // 应用转换公式：物理值 = (原始值 × 1) + 0
    *value = (raw_value * 1) + 0;
    
    // 边界检查
    if (*value < 0 || *value > 1) {
        DBG_PRINT("信号AUDIO4_S_SetTempDown_L越界(值:%.2f, 范围:[%.2f~%.2f])", 
                 *value, 0, 1);
        return false;
    }
    
    DBG_PRINT("获取AUDIO4_S_SetTempDown_L成功: %.2f", *value);
    return true;
}

/*----------------------------------------------------------------*
 * 函数名：Set_AUDIO4_S_SetTempDown_L
 * 功能：设置温度下降按下按钮发1（发三次），松开后发0，区别长短按，长按一直发0信号值
 * 参数：
 *   - frame: CAN帧指针
 *   - value: 输入信号值
 * 返回值：操作是否成功
 * 注意：温度下降按下按钮发1（发三次），松开后发0，区别长短按，长按一直发0
 *----------------------------------------------------------------*/
bool Set_AUDIO4_S_SetTempDown_L(CAN_Frame* frame, float value) {
    // 边界检查
    if (value < 0 || value > 1) {
        DBG_PRINT("信号AUDIO4_S_SetTempDown_L越界(值:%.2f, 范围:[%.2f~%.2f])", 
                 value, 0, 1);
        return false;
    }
    
    // 计算原始值：原始值 = (物理值 - 0) / 1
    uint64_t raw_value = (uint64_t)round((value - 0) / 1);
    
    // 设置原始信号值
    // 大端模式处理
    for (int i = 0; i < 1; i++) {
        int byte_pos = 2 - (i / 8);
        int bit_pos = 1 + (i % 8);
        uint8_t bit_val = GET_BIT(raw_value, i);
        SET_BIT(frame->data[byte_pos], bit_pos, bit_val);
    }
    
    // 设置报文ID和长度
    frame->id = 0x374;
    frame->dlc = 8;
    
    DBG_PRINT("设置AUDIO4_S_SetTempDown_L成功: %.2f", value);
    return true;
}
/*----------------------------------------------------------------*
 * 函数名：Get_AUDIO4_S_SYNC
 * 功能：获取同步按下按钮发1，松开后发0VM2预留信号值
 * 参数：
 *   - frame: CAN帧指针
 *   - value: 输出信号值指针
 * 返回值：操作是否成功
 * 注意：同步按下按钮发1，松开后发0VM2预留
 *----------------------------------------------------------------*/
bool Get_AUDIO4_S_SYNC(const CAN_Frame* frame, float* value) {
    // 校验输入参数
    ERROR_TRAP(frame != NULL, "空指针异常");
    ERROR_TRAP(value != NULL, "输出参数无效");
    
    // 校验报文ID
    if (frame->id != 0x374) {
        DBG_PRINT("报文ID不匹配(预期:0x374, 实际:0x%X)", frame->id);
        return false;
    }
    
    // 提取原始信号值
    uint64_t raw_value = 0;
    // 大端模式处理
    for (int i = 0; i < 1; i++) {
        int byte_pos = 2 - (i / 8);
        int bit_pos = 2 + (i % 8);
        SET_BIT(raw_value, i, GET_BIT(frame->data[byte_pos], bit_pos));
    }
    
    // 应用转换公式：物理值 = (原始值 × 1) + 0
    *value = (raw_value * 1) + 0;
    
    // 边界检查
    if (*value < 0 || *value > 1) {
        DBG_PRINT("信号AUDIO4_S_SYNC越界(值:%.2f, 范围:[%.2f~%.2f])", 
                 *value, 0, 1);
        return false;
    }
    
    DBG_PRINT("获取AUDIO4_S_SYNC成功: %.2f", *value);
    return true;
}

/*----------------------------------------------------------------*
 * 函数名：Set_AUDIO4_S_SYNC
 * 功能：设置同步按下按钮发1，松开后发0VM2预留信号值
 * 参数：
 *   - frame: CAN帧指针
 *   - value: 输入信号值
 * 返回值：操作是否成功
 * 注意：同步按下按钮发1，松开后发0VM2预留
 *----------------------------------------------------------------*/
bool Set_AUDIO4_S_SYNC(CAN_Frame* frame, float value) {
    // 边界检查
    if (value < 0 || value > 1) {
        DBG_PRINT("信号AUDIO4_S_SYNC越界(值:%.2f, 范围:[%.2f~%.2f])", 
                 value, 0, 1);
        return false;
    }
    
    // 计算原始值：原始值 = (物理值 - 0) / 1
    uint64_t raw_value = (uint64_t)round((value - 0) / 1);
    
    // 设置原始信号值
    // 大端模式处理
    for (int i = 0; i < 1; i++) {
        int byte_pos = 2 - (i / 8);
        int bit_pos = 2 + (i % 8);
        uint8_t bit_val = GET_BIT(raw_value, i);
        SET_BIT(frame->data[byte_pos], bit_pos, bit_val);
    }
    
    // 设置报文ID和长度
    frame->id = 0x374;
    frame->dlc = 8;
    
    DBG_PRINT("设置AUDIO4_S_SYNC成功: %.2f", value);
    return true;
}
/*----------------------------------------------------------------*
 * 函数名：Get_AUDIO4_St_SetTemp_L
 * 功能：获取温度设置_左侧电动空调不收(物理开关和大屏软开关平台化，按左右物理位置发送，不区分左右舵，不做镜像，单温区只发左侧开关)VM2:只做自动空调前空调的温度设置信号值
 * 参数：
 *   - frame: CAN帧指针
 *   - value: 输出信号值指针
 * 返回值：操作是否成功
 * 注意：温度设置_左侧电动空调不收(物理开关和大屏软开关平台化，按左右物理位置发送，不区分左右舵，不做镜像，单温区只发左侧开关)VM2:只做自动空调前空调的温度设置
 *----------------------------------------------------------------*/
bool Get_AUDIO4_St_SetTemp_L(const CAN_Frame* frame, float* value) {
    // 校验输入参数
    ERROR_TRAP(frame != NULL, "空指针异常");
    ERROR_TRAP(value != NULL, "输出参数无效");
    
    // 校验报文ID
    if (frame->id != 0x374) {
        DBG_PRINT("报文ID不匹配(预期:0x374, 实际:0x%X)", frame->id);
        return false;
    }
    
    // 提取原始信号值
    uint64_t raw_value = 0;
    // 大端模式处理
    for (int i = 0; i < 5; i++) {
        int byte_pos = 2 - (i / 8);
        int bit_pos = 7 + (i % 8);
        SET_BIT(raw_value, i, GET_BIT(frame->data[byte_pos], bit_pos));
    }
    
    // 应用转换公式：物理值 = (原始值 × 0.5) + 18
    *value = (raw_value * 0.5) + 18;
    
    // 边界检查
    if (*value < 18 || *value > 32) {
        DBG_PRINT("信号AUDIO4_St_SetTemp_L越界(值:%.2f, 范围:[%.2f~%.2f])", 
                 *value, 18, 32);
        return false;
    }
    
    DBG_PRINT("获取AUDIO4_St_SetTemp_L成功: %.2f", *value);
    return true;
}

/*----------------------------------------------------------------*
 * 函数名：Set_AUDIO4_St_SetTemp_L
 * 功能：设置温度设置_左侧电动空调不收(物理开关和大屏软开关平台化，按左右物理位置发送，不区分左右舵，不做镜像，单温区只发左侧开关)VM2:只做自动空调前空调的温度设置信号值
 * 参数：
 *   - frame: CAN帧指针
 *   - value: 输入信号值
 * 返回值：操作是否成功
 * 注意：温度设置_左侧电动空调不收(物理开关和大屏软开关平台化，按左右物理位置发送，不区分左右舵，不做镜像，单温区只发左侧开关)VM2:只做自动空调前空调的温度设置
 *----------------------------------------------------------------*/
bool Set_AUDIO4_St_SetTemp_L(CAN_Frame* frame, float value) {
    // 边界检查
    if (value < 18 || value > 32) {
        DBG_PRINT("信号AUDIO4_St_SetTemp_L越界(值:%.2f, 范围:[%.2f~%.2f])", 
                 value, 18, 32);
        return false;
    }
    
    // 计算原始值：原始值 = (物理值 - 18) / 0.5
    uint64_t raw_value = (uint64_t)round((value - 18) / 0.5);
    
    // 设置原始信号值
    // 大端模式处理
    for (int i = 0; i < 5; i++) {
        int byte_pos = 2 - (i / 8);
        int bit_pos = 7 + (i % 8);
        uint8_t bit_val = GET_BIT(raw_value, i);
        SET_BIT(frame->data[byte_pos], bit_pos, bit_val);
    }
    
    // 设置报文ID和长度
    frame->id = 0x374;
    frame->dlc = 8;
    
    DBG_PRINT("设置AUDIO4_St_SetTemp_L成功: %.2f", value);
    return true;
}
/*----------------------------------------------------------------*
 * 函数名：Get_AUDIO4_S_TempLevelElectricAC
 * 功能：获取温度档位(只有电动空调接收)VM2：预留信号值
 * 参数：
 *   - frame: CAN帧指针
 *   - value: 输出信号值指针
 * 返回值：操作是否成功
 * 注意：温度档位(只有电动空调接收)VM2：预留
 *----------------------------------------------------------------*/
bool Get_AUDIO4_S_TempLevelElectricAC(const CAN_Frame* frame, float* value) {
    // 校验输入参数
    ERROR_TRAP(frame != NULL, "空指针异常");
    ERROR_TRAP(value != NULL, "输出参数无效");
    
    // 校验报文ID
    if (frame->id != 0x374) {
        DBG_PRINT("报文ID不匹配(预期:0x374, 实际:0x%X)", frame->id);
        return false;
    }
    
    // 提取原始信号值
    uint64_t raw_value = 0;
    // 大端模式处理
    for (int i = 0; i < 5; i++) {
        int byte_pos = 3 - (i / 8);
        int bit_pos = 5 + (i % 8);
        SET_BIT(raw_value, i, GET_BIT(frame->data[byte_pos], bit_pos));
    }
    
    // 应用转换公式：物理值 = (原始值 × 1) + 0
    *value = (raw_value * 1) + 0;
    
    // 边界检查
    if (*value < 0 || *value > 16) {
        DBG_PRINT("信号AUDIO4_S_TempLevelElectricAC越界(值:%.2f, 范围:[%.2f~%.2f])", 
                 *value, 0, 16);
        return false;
    }
    
    DBG_PRINT("获取AUDIO4_S_TempLevelElectricAC成功: %.2f", *value);
    return true;
}

/*----------------------------------------------------------------*
 * 函数名：Set_AUDIO4_S_TempLevelElectricAC
 * 功能：设置温度档位(只有电动空调接收)VM2：预留信号值
 * 参数：
 *   - frame: CAN帧指针
 *   - value: 输入信号值
 * 返回值：操作是否成功
 * 注意：温度档位(只有电动空调接收)VM2：预留
 *----------------------------------------------------------------*/
bool Set_AUDIO4_S_TempLevelElectricAC(CAN_Frame* frame, float value) {
    // 边界检查
    if (value < 0 || value > 16) {
        DBG_PRINT("信号AUDIO4_S_TempLevelElectricAC越界(值:%.2f, 范围:[%.2f~%.2f])", 
                 value, 0, 16);
        return false;
    }
    
    // 计算原始值：原始值 = (物理值 - 0) / 1
    uint64_t raw_value = (uint64_t)round((value - 0) / 1);
    
    // 设置原始信号值
    // 大端模式处理
    for (int i = 0; i < 5; i++) {
        int byte_pos = 3 - (i / 8);
        int bit_pos = 5 + (i % 8);
        uint8_t bit_val = GET_BIT(raw_value, i);
        SET_BIT(frame->data[byte_pos], bit_pos, bit_val);
    }
    
    // 设置报文ID和长度
    frame->id = 0x374;
    frame->dlc = 8;
    
    DBG_PRINT("设置AUDIO4_S_TempLevelElectricAC成功: %.2f", value);
    return true;
}
/*----------------------------------------------------------------*
 * 函数名：Get_AUDIO4_St_SetBlower
 * 功能：获取风机档位设置信号值
 * 参数：
 *   - frame: CAN帧指针
 *   - value: 输出信号值指针
 * 返回值：操作是否成功
 * 注意：风机档位设置
 *----------------------------------------------------------------*/
bool Get_AUDIO4_St_SetBlower(const CAN_Frame* frame, float* value) {
    // 校验输入参数
    ERROR_TRAP(frame != NULL, "空指针异常");
    ERROR_TRAP(value != NULL, "输出参数无效");
    
    // 校验报文ID
    if (frame->id != 0x374) {
        DBG_PRINT("报文ID不匹配(预期:0x374, 实际:0x%X)", frame->id);
        return false;
    }
    
    // 提取原始信号值
    uint64_t raw_value = 0;
    // 大端模式处理
    for (int i = 0; i < 4; i++) {
        int byte_pos = 4 - (i / 8);
        int bit_pos = 5 + (i % 8);
        SET_BIT(raw_value, i, GET_BIT(frame->data[byte_pos], bit_pos));
    }
    
    // 应用转换公式：物理值 = (原始值 × 1) + 0
    *value = (raw_value * 1) + 0;
    
    // 边界检查
    if (*value < 0 || *value > 15) {
        DBG_PRINT("信号AUDIO4_St_SetBlower越界(值:%.2f, 范围:[%.2f~%.2f])", 
                 *value, 0, 15);
        return false;
    }
    
    DBG_PRINT("获取AUDIO4_St_SetBlower成功: %.2f", *value);
    return true;
}

/*----------------------------------------------------------------*
 * 函数名：Set_AUDIO4_St_SetBlower
 * 功能：设置风机档位设置信号值
 * 参数：
 *   - frame: CAN帧指针
 *   - value: 输入信号值
 * 返回值：操作是否成功
 * 注意：风机档位设置
 *----------------------------------------------------------------*/
bool Set_AUDIO4_St_SetBlower(CAN_Frame* frame, float value) {
    // 边界检查
    if (value < 0 || value > 15) {
        DBG_PRINT("信号AUDIO4_St_SetBlower越界(值:%.2f, 范围:[%.2f~%.2f])", 
                 value, 0, 15);
        return false;
    }
    
    // 计算原始值：原始值 = (物理值 - 0) / 1
    uint64_t raw_value = (uint64_t)round((value - 0) / 1);
    
    // 设置原始信号值
    // 大端模式处理
    for (int i = 0; i < 4; i++) {
        int byte_pos = 4 - (i / 8);
        int bit_pos = 5 + (i % 8);
        uint8_t bit_val = GET_BIT(raw_value, i);
        SET_BIT(frame->data[byte_pos], bit_pos, bit_val);
    }
    
    // 设置报文ID和长度
    frame->id = 0x374;
    frame->dlc = 8;
    
    DBG_PRINT("设置AUDIO4_St_SetBlower成功: %.2f", value);
    return true;
}
/*----------------------------------------------------------------*
 * 函数名：Get_AUDIO4_S_NegativeIon
 * 功能：获取负离子的开关命令信号值
 * 参数：
 *   - frame: CAN帧指针
 *   - value: 输出信号值指针
 * 返回值：操作是否成功
 * 注意：负离子的开关命令
 *----------------------------------------------------------------*/
bool Get_AUDIO4_S_NegativeIon(const CAN_Frame* frame, float* value) {
    // 校验输入参数
    ERROR_TRAP(frame != NULL, "空指针异常");
    ERROR_TRAP(value != NULL, "输出参数无效");
    
    // 校验报文ID
    if (frame->id != 0x374) {
        DBG_PRINT("报文ID不匹配(预期:0x374, 实际:0x%X)", frame->id);
        return false;
    }
    
    // 提取原始信号值
    uint64_t raw_value = 0;
    // 大端模式处理
    for (int i = 0; i < 1; i++) {
        int byte_pos = 5 - (i / 8);
        int bit_pos = 1 + (i % 8);
        SET_BIT(raw_value, i, GET_BIT(frame->data[byte_pos], bit_pos));
    }
    
    // 应用转换公式：物理值 = (原始值 × 1) + 0
    *value = (raw_value * 1) + 0;
    
    // 边界检查
    if (*value < 0 || *value > 1) {
        DBG_PRINT("信号AUDIO4_S_NegativeIon越界(值:%.2f, 范围:[%.2f~%.2f])", 
                 *value, 0, 1);
        return false;
    }
    
    DBG_PRINT("获取AUDIO4_S_NegativeIon成功: %.2f", *value);
    return true;
}

/*----------------------------------------------------------------*
 * 函数名：Set_AUDIO4_S_NegativeIon
 * 功能：设置负离子的开关命令信号值
 * 参数：
 *   - frame: CAN帧指针
 *   - value: 输入信号值
 * 返回值：操作是否成功
 * 注意：负离子的开关命令
 *----------------------------------------------------------------*/
bool Set_AUDIO4_S_NegativeIon(CAN_Frame* frame, float value) {
    // 边界检查
    if (value < 0 || value > 1) {
        DBG_PRINT("信号AUDIO4_S_NegativeIon越界(值:%.2f, 范围:[%.2f~%.2f])", 
                 value, 0, 1);
        return false;
    }
    
    // 计算原始值：原始值 = (物理值 - 0) / 1
    uint64_t raw_value = (uint64_t)round((value - 0) / 1);
    
    // 设置原始信号值
    // 大端模式处理
    for (int i = 0; i < 1; i++) {
        int byte_pos = 5 - (i / 8);
        int bit_pos = 1 + (i % 8);
        uint8_t bit_val = GET_BIT(raw_value, i);
        SET_BIT(frame->data[byte_pos], bit_pos, bit_val);
    }
    
    // 设置报文ID和长度
    frame->id = 0x374;
    frame->dlc = 8;
    
    DBG_PRINT("设置AUDIO4_S_NegativeIon成功: %.2f", value);
    return true;
}
/*----------------------------------------------------------------*
 * 函数名：Get_AUDIO4_S_Auto
 * 功能：获取自动空调开关信号值
 * 参数：
 *   - frame: CAN帧指针
 *   - value: 输出信号值指针
 * 返回值：操作是否成功
 * 注意：自动空调开关
 *----------------------------------------------------------------*/
bool Get_AUDIO4_S_Auto(const CAN_Frame* frame, float* value) {
    // 校验输入参数
    ERROR_TRAP(frame != NULL, "空指针异常");
    ERROR_TRAP(value != NULL, "输出参数无效");
    
    // 校验报文ID
    if (frame->id != 0x374) {
        DBG_PRINT("报文ID不匹配(预期:0x374, 实际:0x%X)", frame->id);
        return false;
    }
    
    // 提取原始信号值
    uint64_t raw_value = 0;
    // 大端模式处理
    for (int i = 0; i < 1; i++) {
        int byte_pos = 5 - (i / 8);
        int bit_pos = 2 + (i % 8);
        SET_BIT(raw_value, i, GET_BIT(frame->data[byte_pos], bit_pos));
    }
    
    // 应用转换公式：物理值 = (原始值 × 1) + 0
    *value = (raw_value * 1) + 0;
    
    // 边界检查
    if (*value < 0 || *value > 1) {
        DBG_PRINT("信号AUDIO4_S_Auto越界(值:%.2f, 范围:[%.2f~%.2f])", 
                 *value, 0, 1);
        return false;
    }
    
    DBG_PRINT("获取AUDIO4_S_Auto成功: %.2f", *value);
    return true;
}

/*----------------------------------------------------------------*
 * 函数名：Set_AUDIO4_S_Auto
 * 功能：设置自动空调开关信号值
 * 参数：
 *   - frame: CAN帧指针
 *   - value: 输入信号值
 * 返回值：操作是否成功
 * 注意：自动空调开关
 *----------------------------------------------------------------*/
bool Set_AUDIO4_S_Auto(CAN_Frame* frame, float value) {
    // 边界检查
    if (value < 0 || value > 1) {
        DBG_PRINT("信号AUDIO4_S_Auto越界(值:%.2f, 范围:[%.2f~%.2f])", 
                 value, 0, 1);
        return false;
    }
    
    // 计算原始值：原始值 = (物理值 - 0) / 1
    uint64_t raw_value = (uint64_t)round((value - 0) / 1);
    
    // 设置原始信号值
    // 大端模式处理
    for (int i = 0; i < 1; i++) {
        int byte_pos = 5 - (i / 8);
        int bit_pos = 2 + (i % 8);
        uint8_t bit_val = GET_BIT(raw_value, i);
        SET_BIT(frame->data[byte_pos], bit_pos, bit_val);
    }
    
    // 设置报文ID和长度
    frame->id = 0x374;
    frame->dlc = 8;
    
    DBG_PRINT("设置AUDIO4_S_Auto成功: %.2f", value);
    return true;
}
/*----------------------------------------------------------------*
 * 函数名：Get_AUDIO4_S_AirCirculate
 * 功能：获取循环开关信号值
 * 参数：
 *   - frame: CAN帧指针
 *   - value: 输出信号值指针
 * 返回值：操作是否成功
 * 注意：循环开关
 *----------------------------------------------------------------*/
bool Get_AUDIO4_S_AirCirculate(const CAN_Frame* frame, float* value) {
    // 校验输入参数
    ERROR_TRAP(frame != NULL, "空指针异常");
    ERROR_TRAP(value != NULL, "输出参数无效");
    
    // 校验报文ID
    if (frame->id != 0x374) {
        DBG_PRINT("报文ID不匹配(预期:0x374, 实际:0x%X)", frame->id);
        return false;
    }
    
    // 提取原始信号值
    uint64_t raw_value = 0;
    // 大端模式处理
    for (int i = 0; i < 1; i++) {
        int byte_pos = 5 - (i / 8);
        int bit_pos = 3 + (i % 8);
        SET_BIT(raw_value, i, GET_BIT(frame->data[byte_pos], bit_pos));
    }
    
    // 应用转换公式：物理值 = (原始值 × 1) + 0
    *value = (raw_value * 1) + 0;
    
    // 边界检查
    if (*value < 0 || *value > 1) {
        DBG_PRINT("信号AUDIO4_S_AirCirculate越界(值:%.2f, 范围:[%.2f~%.2f])", 
                 *value, 0, 1);
        return false;
    }
    
    DBG_PRINT("获取AUDIO4_S_AirCirculate成功: %.2f", *value);
    return true;
}

/*----------------------------------------------------------------*
 * 函数名：Set_AUDIO4_S_AirCirculate
 * 功能：设置循环开关信号值
 * 参数：
 *   - frame: CAN帧指针
 *   - value: 输入信号值
 * 返回值：操作是否成功
 * 注意：循环开关
 *----------------------------------------------------------------*/
bool Set_AUDIO4_S_AirCirculate(CAN_Frame* frame, float value) {
    // 边界检查
    if (value < 0 || value > 1) {
        DBG_PRINT("信号AUDIO4_S_AirCirculate越界(值:%.2f, 范围:[%.2f~%.2f])", 
                 value, 0, 1);
        return false;
    }
    
    // 计算原始值：原始值 = (物理值 - 0) / 1
    uint64_t raw_value = (uint64_t)round((value - 0) / 1);
    
    // 设置原始信号值
    // 大端模式处理
    for (int i = 0; i < 1; i++) {
        int byte_pos = 5 - (i / 8);
        int bit_pos = 3 + (i % 8);
        uint8_t bit_val = GET_BIT(raw_value, i);
        SET_BIT(frame->data[byte_pos], bit_pos, bit_val);
    }
    
    // 设置报文ID和长度
    frame->id = 0x374;
    frame->dlc = 8;
    
    DBG_PRINT("设置AUDIO4_S_AirCirculate成功: %.2f", value);
    return true;
}
/*----------------------------------------------------------------*
 * 函数名：Get_AUDIO4_S_ACCompresSwitch
 * 功能：获取AC开关信号值
 * 参数：
 *   - frame: CAN帧指针
 *   - value: 输出信号值指针
 * 返回值：操作是否成功
 * 注意：AC开关
 *----------------------------------------------------------------*/
bool Get_AUDIO4_S_ACCompresSwitch(const CAN_Frame* frame, float* value) {
    // 校验输入参数
    ERROR_TRAP(frame != NULL, "空指针异常");
    ERROR_TRAP(value != NULL, "输出参数无效");
    
    // 校验报文ID
    if (frame->id != 0x374) {
        DBG_PRINT("报文ID不匹配(预期:0x374, 实际:0x%X)", frame->id);
        return false;
    }
    
    // 提取原始信号值
    uint64_t raw_value = 0;
    // 大端模式处理
    for (int i = 0; i < 1; i++) {
        int byte_pos = 5 - (i / 8);
        int bit_pos = 5 + (i % 8);
        SET_BIT(raw_value, i, GET_BIT(frame->data[byte_pos], bit_pos));
    }
    
    // 应用转换公式：物理值 = (原始值 × 1) + 0
    *value = (raw_value * 1) + 0;
    
    // 边界检查
    if (*value < 0 || *value > 1) {
        DBG_PRINT("信号AUDIO4_S_ACCompresSwitch越界(值:%.2f, 范围:[%.2f~%.2f])", 
                 *value, 0, 1);
        return false;
    }
    
    DBG_PRINT("获取AUDIO4_S_ACCompresSwitch成功: %.2f", *value);
    return true;
}

/*----------------------------------------------------------------*
 * 函数名：Set_AUDIO4_S_ACCompresSwitch
 * 功能：设置AC开关信号值
 * 参数：
 *   - frame: CAN帧指针
 *   - value: 输入信号值
 * 返回值：操作是否成功
 * 注意：AC开关
 *----------------------------------------------------------------*/
bool Set_AUDIO4_S_ACCompresSwitch(CAN_Frame* frame, float value) {
    // 边界检查
    if (value < 0 || value > 1) {
        DBG_PRINT("信号AUDIO4_S_ACCompresSwitch越界(值:%.2f, 范围:[%.2f~%.2f])", 
                 value, 0, 1);
        return false;
    }
    
    // 计算原始值：原始值 = (物理值 - 0) / 1
    uint64_t raw_value = (uint64_t)round((value - 0) / 1);
    
    // 设置原始信号值
    // 大端模式处理
    for (int i = 0; i < 1; i++) {
        int byte_pos = 5 - (i / 8);
        int bit_pos = 5 + (i % 8);
        uint8_t bit_val = GET_BIT(raw_value, i);
        SET_BIT(frame->data[byte_pos], bit_pos, bit_val);
    }
    
    // 设置报文ID和长度
    frame->id = 0x374;
    frame->dlc = 8;
    
    DBG_PRINT("设置AUDIO4_S_ACCompresSwitch成功: %.2f", value);
    return true;
}
/*----------------------------------------------------------------*
 * 函数名：Get_AUDIO4_S_CLMOFF
 * 功能：获取空调关闭开关信号值
 * 参数：
 *   - frame: CAN帧指针
 *   - value: 输出信号值指针
 * 返回值：操作是否成功
 * 注意：空调关闭开关
 *----------------------------------------------------------------*/
bool Get_AUDIO4_S_CLMOFF(const CAN_Frame* frame, float* value) {
    // 校验输入参数
    ERROR_TRAP(frame != NULL, "空指针异常");
    ERROR_TRAP(value != NULL, "输出参数无效");
    
    // 校验报文ID
    if (frame->id != 0x374) {
        DBG_PRINT("报文ID不匹配(预期:0x374, 实际:0x%X)", frame->id);
        return false;
    }
    
    // 提取原始信号值
    uint64_t raw_value = 0;
    // 大端模式处理
    for (int i = 0; i < 1; i++) {
        int byte_pos = 5 - (i / 8);
        int bit_pos = 6 + (i % 8);
        SET_BIT(raw_value, i, GET_BIT(frame->data[byte_pos], bit_pos));
    }
    
    // 应用转换公式：物理值 = (原始值 × 1) + 0
    *value = (raw_value * 1) + 0;
    
    // 边界检查
    if (*value < 0 || *value > 1) {
        DBG_PRINT("信号AUDIO4_S_CLMOFF越界(值:%.2f, 范围:[%.2f~%.2f])", 
                 *value, 0, 1);
        return false;
    }
    
    DBG_PRINT("获取AUDIO4_S_CLMOFF成功: %.2f", *value);
    return true;
}

/*----------------------------------------------------------------*
 * 函数名：Set_AUDIO4_S_CLMOFF
 * 功能：设置空调关闭开关信号值
 * 参数：
 *   - frame: CAN帧指针
 *   - value: 输入信号值
 * 返回值：操作是否成功
 * 注意：空调关闭开关
 *----------------------------------------------------------------*/
bool Set_AUDIO4_S_CLMOFF(CAN_Frame* frame, float value) {
    // 边界检查
    if (value < 0 || value > 1) {
        DBG_PRINT("信号AUDIO4_S_CLMOFF越界(值:%.2f, 范围:[%.2f~%.2f])", 
                 value, 0, 1);
        return false;
    }
    
    // 计算原始值：原始值 = (物理值 - 0) / 1
    uint64_t raw_value = (uint64_t)round((value - 0) / 1);
    
    // 设置原始信号值
    // 大端模式处理
    for (int i = 0; i < 1; i++) {
        int byte_pos = 5 - (i / 8);
        int bit_pos = 6 + (i % 8);
        uint8_t bit_val = GET_BIT(raw_value, i);
        SET_BIT(frame->data[byte_pos], bit_pos, bit_val);
    }
    
    // 设置报文ID和长度
    frame->id = 0x374;
    frame->dlc = 8;
    
    DBG_PRINT("设置AUDIO4_S_CLMOFF成功: %.2f", value);
    return true;
}
/*----------------------------------------------------------------*
 * 函数名：Get_AUDIO4_S_RearDefrost
 * 功能：获取后除霜开关信号值
 * 参数：
 *   - frame: CAN帧指针
 *   - value: 输出信号值指针
 * 返回值：操作是否成功
 * 注意：后除霜开关
 *----------------------------------------------------------------*/
bool Get_AUDIO4_S_RearDefrost(const CAN_Frame* frame, float* value) {
    // 校验输入参数
    ERROR_TRAP(frame != NULL, "空指针异常");
    ERROR_TRAP(value != NULL, "输出参数无效");
    
    // 校验报文ID
    if (frame->id != 0x374) {
        DBG_PRINT("报文ID不匹配(预期:0x374, 实际:0x%X)", frame->id);
        return false;
    }
    
    // 提取原始信号值
    uint64_t raw_value = 0;
    // 大端模式处理
    for (int i = 0; i < 1; i++) {
        int byte_pos = 6 - (i / 8);
        int bit_pos = 2 + (i % 8);
        SET_BIT(raw_value, i, GET_BIT(frame->data[byte_pos], bit_pos));
    }
    
    // 应用转换公式：物理值 = (原始值 × 1) + 0
    *value = (raw_value * 1) + 0;
    
    // 边界检查
    if (*value < 0 || *value > 1) {
        DBG_PRINT("信号AUDIO4_S_RearDefrost越界(值:%.2f, 范围:[%.2f~%.2f])", 
                 *value, 0, 1);
        return false;
    }
    
    DBG_PRINT("获取AUDIO4_S_RearDefrost成功: %.2f", *value);
    return true;
}

/*----------------------------------------------------------------*
 * 函数名：Set_AUDIO4_S_RearDefrost
 * 功能：设置后除霜开关信号值
 * 参数：
 *   - frame: CAN帧指针
 *   - value: 输入信号值
 * 返回值：操作是否成功
 * 注意：后除霜开关
 *----------------------------------------------------------------*/
bool Set_AUDIO4_S_RearDefrost(CAN_Frame* frame, float value) {
    // 边界检查
    if (value < 0 || value > 1) {
        DBG_PRINT("信号AUDIO4_S_RearDefrost越界(值:%.2f, 范围:[%.2f~%.2f])", 
                 value, 0, 1);
        return false;
    }
    
    // 计算原始值：原始值 = (物理值 - 0) / 1
    uint64_t raw_value = (uint64_t)round((value - 0) / 1);
    
    // 设置原始信号值
    // 大端模式处理
    for (int i = 0; i < 1; i++) {
        int byte_pos = 6 - (i / 8);
        int bit_pos = 2 + (i % 8);
        uint8_t bit_val = GET_BIT(raw_value, i);
        SET_BIT(frame->data[byte_pos], bit_pos, bit_val);
    }
    
    // 设置报文ID和长度
    frame->id = 0x374;
    frame->dlc = 8;
    
    DBG_PRINT("设置AUDIO4_S_RearDefrost成功: %.2f", value);
    return true;
}
/*----------------------------------------------------------------*
 * 函数名：Get_AUDIO4_S_FRMPositionSet
 * 功能：获取香氛位置设置命令信号值
 * 参数：
 *   - frame: CAN帧指针
 *   - value: 输出信号值指针
 * 返回值：操作是否成功
 * 注意：香氛位置设置命令
 *----------------------------------------------------------------*/
bool Get_AUDIO4_S_FRMPositionSet(const CAN_Frame* frame, float* value) {
    // 校验输入参数
    ERROR_TRAP(frame != NULL, "空指针异常");
    ERROR_TRAP(value != NULL, "输出参数无效");
    
    // 校验报文ID
    if (frame->id != 0x374) {
        DBG_PRINT("报文ID不匹配(预期:0x374, 实际:0x%X)", frame->id);
        return false;
    }
    
    // 提取原始信号值
    uint64_t raw_value = 0;
    // 大端模式处理
    for (int i = 0; i < 4; i++) {
        int byte_pos = 6 - (i / 8);
        int bit_pos = 6 + (i % 8);
        SET_BIT(raw_value, i, GET_BIT(frame->data[byte_pos], bit_pos));
    }
    
    // 应用转换公式：物理值 = (原始值 × 1) + 0
    *value = (raw_value * 1) + 0;
    
    // 边界检查
    if (*value < 0 || *value > 15) {
        DBG_PRINT("信号AUDIO4_S_FRMPositionSet越界(值:%.2f, 范围:[%.2f~%.2f])", 
                 *value, 0, 15);
        return false;
    }
    
    DBG_PRINT("获取AUDIO4_S_FRMPositionSet成功: %.2f", *value);
    return true;
}

/*----------------------------------------------------------------*
 * 函数名：Set_AUDIO4_S_FRMPositionSet
 * 功能：设置香氛位置设置命令信号值
 * 参数：
 *   - frame: CAN帧指针
 *   - value: 输入信号值
 * 返回值：操作是否成功
 * 注意：香氛位置设置命令
 *----------------------------------------------------------------*/
bool Set_AUDIO4_S_FRMPositionSet(CAN_Frame* frame, float value) {
    // 边界检查
    if (value < 0 || value > 15) {
        DBG_PRINT("信号AUDIO4_S_FRMPositionSet越界(值:%.2f, 范围:[%.2f~%.2f])", 
                 value, 0, 15);
        return false;
    }
    
    // 计算原始值：原始值 = (物理值 - 0) / 1
    uint64_t raw_value = (uint64_t)round((value - 0) / 1);
    
    // 设置原始信号值
    // 大端模式处理
    for (int i = 0; i < 4; i++) {
        int byte_pos = 6 - (i / 8);
        int bit_pos = 6 + (i % 8);
        uint8_t bit_val = GET_BIT(raw_value, i);
        SET_BIT(frame->data[byte_pos], bit_pos, bit_val);
    }
    
    // 设置报文ID和长度
    frame->id = 0x374;
    frame->dlc = 8;
    
    DBG_PRINT("设置AUDIO4_S_FRMPositionSet成功: %.2f", value);
    return true;
}
/*----------------------------------------------------------------*
 * 函数名：Get_AC2_Checksum
 * 功能：获取Checksum信号值
 * 参数：
 *   - frame: CAN帧指针
 *   - value: 输出信号值指针
 * 返回值：操作是否成功
 * 注意：Checksum
 *----------------------------------------------------------------*/
bool Get_AC2_Checksum(const CAN_Frame* frame, float* value) {
    // 校验输入参数
    ERROR_TRAP(frame != NULL, "空指针异常");
    ERROR_TRAP(value != NULL, "输出参数无效");
    
    // 校验报文ID
    if (frame->id != 0x46C) {
        DBG_PRINT("报文ID不匹配(预期:0x46C, 实际:0x%X)", frame->id);
        return false;
    }
    
    // 提取原始信号值
    uint64_t raw_value = 0;
    // 大端模式处理
    for (int i = 0; i < 8; i++) {
        int byte_pos = 0 - (i / 8);
        int bit_pos = 7 + (i % 8);
        SET_BIT(raw_value, i, GET_BIT(frame->data[byte_pos], bit_pos));
    }
    
    // 应用转换公式：物理值 = (原始值 × 1) + 0
    *value = (raw_value * 1) + 0;
    
    // 边界检查
    if (*value < 0 || *value > 255) {
        DBG_PRINT("信号AC2_Checksum越界(值:%.2f, 范围:[%.2f~%.2f])", 
                 *value, 0, 255);
        return false;
    }
    
    DBG_PRINT("获取AC2_Checksum成功: %.2f", *value);
    return true;
}

/*----------------------------------------------------------------*
 * 函数名：Set_AC2_Checksum
 * 功能：设置Checksum信号值
 * 参数：
 *   - frame: CAN帧指针
 *   - value: 输入信号值
 * 返回值：操作是否成功
 * 注意：Checksum
 *----------------------------------------------------------------*/
bool Set_AC2_Checksum(CAN_Frame* frame, float value) {
    // 边界检查
    if (value < 0 || value > 255) {
        DBG_PRINT("信号AC2_Checksum越界(值:%.2f, 范围:[%.2f~%.2f])", 
                 value, 0, 255);
        return false;
    }
    
    // 计算原始值：原始值 = (物理值 - 0) / 1
    uint64_t raw_value = (uint64_t)round((value - 0) / 1);
    
    // 设置原始信号值
    // 大端模式处理
    for (int i = 0; i < 8; i++) {
        int byte_pos = 0 - (i / 8);
        int bit_pos = 7 + (i % 8);
        uint8_t bit_val = GET_BIT(raw_value, i);
        SET_BIT(frame->data[byte_pos], bit_pos, bit_val);
    }
    
    // 设置报文ID和长度
    frame->id = 0x46C;
    frame->dlc = 8;
    
    DBG_PRINT("设置AC2_Checksum成功: %.2f", value);
    return true;
}
/*----------------------------------------------------------------*
 * 函数名：Get_AC2_N_InsideCarTemp
 * 功能：获取车内温度信号值
 * 参数：
 *   - frame: CAN帧指针
 *   - value: 输出信号值指针
 * 返回值：操作是否成功
 * 注意：车内温度
 *----------------------------------------------------------------*/
bool Get_AC2_N_InsideCarTemp(const CAN_Frame* frame, float* value) {
    // 校验输入参数
    ERROR_TRAP(frame != NULL, "空指针异常");
    ERROR_TRAP(value != NULL, "输出参数无效");
    
    // 校验报文ID
    if (frame->id != 0x46C) {
        DBG_PRINT("报文ID不匹配(预期:0x46C, 实际:0x%X)", frame->id);
        return false;
    }
    
    // 提取原始信号值
    uint64_t raw_value = 0;
    // 大端模式处理
    for (int i = 0; i < 8; i++) {
        int byte_pos = 2 - (i / 8);
        int bit_pos = 7 + (i % 8);
        SET_BIT(raw_value, i, GET_BIT(frame->data[byte_pos], bit_pos));
    }
    
    // 应用转换公式：物理值 = (原始值 × 0.5) + -50
    *value = (raw_value * 0.5) + -50;
    
    // 边界检查
    if (*value < -50 || *value > 77) {
        DBG_PRINT("信号AC2_N_InsideCarTemp越界(值:%.2f, 范围:[%.2f~%.2f])", 
                 *value, -50, 77);
        return false;
    }
    
    DBG_PRINT("获取AC2_N_InsideCarTemp成功: %.2f", *value);
    return true;
}

/*----------------------------------------------------------------*
 * 函数名：Set_AC2_N_InsideCarTemp
 * 功能：设置车内温度信号值
 * 参数：
 *   - frame: CAN帧指针
 *   - value: 输入信号值
 * 返回值：操作是否成功
 * 注意：车内温度
 *----------------------------------------------------------------*/
bool Set_AC2_N_InsideCarTemp(CAN_Frame* frame, float value) {
    // 边界检查
    if (value < -50 || value > 77) {
        DBG_PRINT("信号AC2_N_InsideCarTemp越界(值:%.2f, 范围:[%.2f~%.2f])", 
                 value, -50, 77);
        return false;
    }
    
    // 计算原始值：原始值 = (物理值 - -50) / 0.5
    uint64_t raw_value = (uint64_t)round((value - -50) / 0.5);
    
    // 设置原始信号值
    // 大端模式处理
    for (int i = 0; i < 8; i++) {
        int byte_pos = 2 - (i / 8);
        int bit_pos = 7 + (i % 8);
        uint8_t bit_val = GET_BIT(raw_value, i);
        SET_BIT(frame->data[byte_pos], bit_pos, bit_val);
    }
    
    // 设置报文ID和长度
    frame->id = 0x46C;
    frame->dlc = 8;
    
    DBG_PRINT("设置AC2_N_InsideCarTemp成功: %.2f", value);
    return true;
}
/*----------------------------------------------------------------*
 * 函数名：Get_AC2_N_EnvironmentTemp
 * 功能：获取环境温度（电动/自动空调都能发，传统车发，电动车不发）信号值
 * 参数：
 *   - frame: CAN帧指针
 *   - value: 输出信号值指针
 * 返回值：操作是否成功
 * 注意：环境温度（电动/自动空调都能发，传统车发，电动车不发）
 *----------------------------------------------------------------*/
bool Get_AC2_N_EnvironmentTemp(const CAN_Frame* frame, float* value) {
    // 校验输入参数
    ERROR_TRAP(frame != NULL, "空指针异常");
    ERROR_TRAP(value != NULL, "输出参数无效");
    
    // 校验报文ID
    if (frame->id != 0x46C) {
        DBG_PRINT("报文ID不匹配(预期:0x46C, 实际:0x%X)", frame->id);
        return false;
    }
    
    // 提取原始信号值
    uint64_t raw_value = 0;
    // 大端模式处理
    for (int i = 0; i < 8; i++) {
        int byte_pos = 3 - (i / 8);
        int bit_pos = 7 + (i % 8);
        SET_BIT(raw_value, i, GET_BIT(frame->data[byte_pos], bit_pos));
    }
    
    // 应用转换公式：物理值 = (原始值 × 0.5) + -50
    *value = (raw_value * 0.5) + -50;
    
    // 边界检查
    if (*value < -50 || *value > 77) {
        DBG_PRINT("信号AC2_N_EnvironmentTemp越界(值:%.2f, 范围:[%.2f~%.2f])", 
                 *value, -50, 77);
        return false;
    }
    
    DBG_PRINT("获取AC2_N_EnvironmentTemp成功: %.2f", *value);
    return true;
}

/*----------------------------------------------------------------*
 * 函数名：Set_AC2_N_EnvironmentTemp
 * 功能：设置环境温度（电动/自动空调都能发，传统车发，电动车不发）信号值
 * 参数：
 *   - frame: CAN帧指针
 *   - value: 输入信号值
 * 返回值：操作是否成功
 * 注意：环境温度（电动/自动空调都能发，传统车发，电动车不发）
 *----------------------------------------------------------------*/
bool Set_AC2_N_EnvironmentTemp(CAN_Frame* frame, float value) {
    // 边界检查
    if (value < -50 || value > 77) {
        DBG_PRINT("信号AC2_N_EnvironmentTemp越界(值:%.2f, 范围:[%.2f~%.2f])", 
                 value, -50, 77);
        return false;
    }
    
    // 计算原始值：原始值 = (物理值 - -50) / 0.5
    uint64_t raw_value = (uint64_t)round((value - -50) / 0.5);
    
    // 设置原始信号值
    // 大端模式处理
    for (int i = 0; i < 8; i++) {
        int byte_pos = 3 - (i / 8);
        int bit_pos = 7 + (i % 8);
        uint8_t bit_val = GET_BIT(raw_value, i);
        SET_BIT(frame->data[byte_pos], bit_pos, bit_val);
    }
    
    // 设置报文ID和长度
    frame->id = 0x46C;
    frame->dlc = 8;
    
    DBG_PRINT("设置AC2_N_EnvironmentTemp成功: %.2f", value);
    return true;
}
/*----------------------------------------------------------------*
 * 函数名：Get_AC2_St_SetTempAutomaticAC_L
 * 功能：获取温度设置_左侧电动空调不发(物理开关和大屏软开关平台化，按左右物理位置发送，不区分左右舵，不做镜像，单温区只发左侧开关)信号值
 * 参数：
 *   - frame: CAN帧指针
 *   - value: 输出信号值指针
 * 返回值：操作是否成功
 * 注意：温度设置_左侧电动空调不发(物理开关和大屏软开关平台化，按左右物理位置发送，不区分左右舵，不做镜像，单温区只发左侧开关)
 *----------------------------------------------------------------*/
bool Get_AC2_St_SetTempAutomaticAC_L(const CAN_Frame* frame, float* value) {
    // 校验输入参数
    ERROR_TRAP(frame != NULL, "空指针异常");
    ERROR_TRAP(value != NULL, "输出参数无效");
    
    // 校验报文ID
    if (frame->id != 0x46C) {
        DBG_PRINT("报文ID不匹配(预期:0x46C, 实际:0x%X)", frame->id);
        return false;
    }
    
    // 提取原始信号值
    uint64_t raw_value = 0;
    // 大端模式处理
    for (int i = 0; i < 5; i++) {
        int byte_pos = 5 - (i / 8);
        int bit_pos = 4 + (i % 8);
        SET_BIT(raw_value, i, GET_BIT(frame->data[byte_pos], bit_pos));
    }
    
    // 应用转换公式：物理值 = (原始值 × 0.5) + 18
    *value = (raw_value * 0.5) + 18;
    
    // 边界检查
    if (*value < 18 || *value > 32) {
        DBG_PRINT("信号AC2_St_SetTempAutomaticAC_L越界(值:%.2f, 范围:[%.2f~%.2f])", 
                 *value, 18, 32);
        return false;
    }
    
    DBG_PRINT("获取AC2_St_SetTempAutomaticAC_L成功: %.2f", *value);
    return true;
}

/*----------------------------------------------------------------*
 * 函数名：Set_AC2_St_SetTempAutomaticAC_L
 * 功能：设置温度设置_左侧电动空调不发(物理开关和大屏软开关平台化，按左右物理位置发送，不区分左右舵，不做镜像，单温区只发左侧开关)信号值
 * 参数：
 *   - frame: CAN帧指针
 *   - value: 输入信号值
 * 返回值：操作是否成功
 * 注意：温度设置_左侧电动空调不发(物理开关和大屏软开关平台化，按左右物理位置发送，不区分左右舵，不做镜像，单温区只发左侧开关)
 *----------------------------------------------------------------*/
bool Set_AC2_St_SetTempAutomaticAC_L(CAN_Frame* frame, float value) {
    // 边界检查
    if (value < 18 || value > 32) {
        DBG_PRINT("信号AC2_St_SetTempAutomaticAC_L越界(值:%.2f, 范围:[%.2f~%.2f])", 
                 value, 18, 32);
        return false;
    }
    
    // 计算原始值：原始值 = (物理值 - 18) / 0.5
    uint64_t raw_value = (uint64_t)round((value - 18) / 0.5);
    
    // 设置原始信号值
    // 大端模式处理
    for (int i = 0; i < 5; i++) {
        int byte_pos = 5 - (i / 8);
        int bit_pos = 4 + (i % 8);
        uint8_t bit_val = GET_BIT(raw_value, i);
        SET_BIT(frame->data[byte_pos], bit_pos, bit_val);
    }
    
    // 设置报文ID和长度
    frame->id = 0x46C;
    frame->dlc = 8;
    
    DBG_PRINT("设置AC2_St_SetTempAutomaticAC_L成功: %.2f", value);
    return true;
}
/*----------------------------------------------------------------*
 * 函数名：Get_AC2_St_TempLevelElectricAC
 * 功能：获取温度档位(电动空调发温度档位信号，大屏对电动空调不做策略所以不收)信号值
 * 参数：
 *   - frame: CAN帧指针
 *   - value: 输出信号值指针
 * 返回值：操作是否成功
 * 注意：温度档位(电动空调发温度档位信号，大屏对电动空调不做策略所以不收)
 *----------------------------------------------------------------*/
bool Get_AC2_St_TempLevelElectricAC(const CAN_Frame* frame, float* value) {
    // 校验输入参数
    ERROR_TRAP(frame != NULL, "空指针异常");
    ERROR_TRAP(value != NULL, "输出参数无效");
    
    // 校验报文ID
    if (frame->id != 0x46C) {
        DBG_PRINT("报文ID不匹配(预期:0x46C, 实际:0x%X)", frame->id);
        return false;
    }
    
    // 提取原始信号值
    uint64_t raw_value = 0;
    // 大端模式处理
    for (int i = 0; i < 5; i++) {
        int byte_pos = 6 - (i / 8);
        int bit_pos = 4 + (i % 8);
        SET_BIT(raw_value, i, GET_BIT(frame->data[byte_pos], bit_pos));
    }
    
    // 应用转换公式：物理值 = (原始值 × 1) + 0
    *value = (raw_value * 1) + 0;
    
    // 边界检查
    if (*value < 0 || *value > 16) {
        DBG_PRINT("信号AC2_St_TempLevelElectricAC越界(值:%.2f, 范围:[%.2f~%.2f])", 
                 *value, 0, 16);
        return false;
    }
    
    DBG_PRINT("获取AC2_St_TempLevelElectricAC成功: %.2f", *value);
    return true;
}

/*----------------------------------------------------------------*
 * 函数名：Set_AC2_St_TempLevelElectricAC
 * 功能：设置温度档位(电动空调发温度档位信号，大屏对电动空调不做策略所以不收)信号值
 * 参数：
 *   - frame: CAN帧指针
 *   - value: 输入信号值
 * 返回值：操作是否成功
 * 注意：温度档位(电动空调发温度档位信号，大屏对电动空调不做策略所以不收)
 *----------------------------------------------------------------*/
bool Set_AC2_St_TempLevelElectricAC(CAN_Frame* frame, float value) {
    // 边界检查
    if (value < 0 || value > 16) {
        DBG_PRINT("信号AC2_St_TempLevelElectricAC越界(值:%.2f, 范围:[%.2f~%.2f])", 
                 value, 0, 16);
        return false;
    }
    
    // 计算原始值：原始值 = (物理值 - 0) / 1
    uint64_t raw_value = (uint64_t)round((value - 0) / 1);
    
    // 设置原始信号值
    // 大端模式处理
    for (int i = 0; i < 5; i++) {
        int byte_pos = 6 - (i / 8);
        int bit_pos = 4 + (i % 8);
        uint8_t bit_val = GET_BIT(raw_value, i);
        SET_BIT(frame->data[byte_pos], bit_pos, bit_val);
    }
    
    // 设置报文ID和长度
    frame->id = 0x46C;
    frame->dlc = 8;
    
    DBG_PRINT("设置AC2_St_TempLevelElectricAC成功: %.2f", value);
    return true;
}
/*----------------------------------------------------------------*
 * 函数名：Get_AC2_St_FLSeatHeating
 * 功能：获取左前座椅加热状态信号值
 * 参数：
 *   - frame: CAN帧指针
 *   - value: 输出信号值指针
 * 返回值：操作是否成功
 * 注意：左前座椅加热状态
 *----------------------------------------------------------------*/
bool Get_AC2_St_FLSeatHeating(const CAN_Frame* frame, float* value) {
    // 校验输入参数
    ERROR_TRAP(frame != NULL, "空指针异常");
    ERROR_TRAP(value != NULL, "输出参数无效");
    
    // 校验报文ID
    if (frame->id != 0x46C) {
        DBG_PRINT("报文ID不匹配(预期:0x46C, 实际:0x%X)", frame->id);
        return false;
    }
    
    // 提取原始信号值
    uint64_t raw_value = 0;
    // 大端模式处理
    for (int i = 0; i < 3; i++) {
        int byte_pos = 7 - (i / 8);
        int bit_pos = 2 + (i % 8);
        SET_BIT(raw_value, i, GET_BIT(frame->data[byte_pos], bit_pos));
    }
    
    // 应用转换公式：物理值 = (原始值 × 1) + 0
    *value = (raw_value * 1) + 0;
    
    // 边界检查
    if (*value < 0 || *value > 7) {
        DBG_PRINT("信号AC2_St_FLSeatHeating越界(值:%.2f, 范围:[%.2f~%.2f])", 
                 *value, 0, 7);
        return false;
    }
    
    DBG_PRINT("获取AC2_St_FLSeatHeating成功: %.2f", *value);
    return true;
}

/*----------------------------------------------------------------*
 * 函数名：Set_AC2_St_FLSeatHeating
 * 功能：设置左前座椅加热状态信号值
 * 参数：
 *   - frame: CAN帧指针
 *   - value: 输入信号值
 * 返回值：操作是否成功
 * 注意：左前座椅加热状态
 *----------------------------------------------------------------*/
bool Set_AC2_St_FLSeatHeating(CAN_Frame* frame, float value) {
    // 边界检查
    if (value < 0 || value > 7) {
        DBG_PRINT("信号AC2_St_FLSeatHeating越界(值:%.2f, 范围:[%.2f~%.2f])", 
                 value, 0, 7);
        return false;
    }
    
    // 计算原始值：原始值 = (物理值 - 0) / 1
    uint64_t raw_value = (uint64_t)round((value - 0) / 1);
    
    // 设置原始信号值
    // 大端模式处理
    for (int i = 0; i < 3; i++) {
        int byte_pos = 7 - (i / 8);
        int bit_pos = 2 + (i % 8);
        uint8_t bit_val = GET_BIT(raw_value, i);
        SET_BIT(frame->data[byte_pos], bit_pos, bit_val);
    }
    
    // 设置报文ID和长度
    frame->id = 0x46C;
    frame->dlc = 8;
    
    DBG_PRINT("设置AC2_St_FLSeatHeating成功: %.2f", value);
    return true;
}
/*----------------------------------------------------------------*
 * 函数名：Get_AC2_St_RemoteControl
 * 功能：获取空调成功接收到TBOX远程启动空调命令接收到远程启动命令，水温不满足空调启动条件时发送信号值1VM2:预留此信号信号值
 * 参数：
 *   - frame: CAN帧指针
 *   - value: 输出信号值指针
 * 返回值：操作是否成功
 * 注意：空调成功接收到TBOX远程启动空调命令接收到远程启动命令，水温不满足空调启动条件时发送信号值1VM2:预留此信号
 *----------------------------------------------------------------*/
bool Get_AC2_St_RemoteControl(const CAN_Frame* frame, float* value) {
    // 校验输入参数
    ERROR_TRAP(frame != NULL, "空指针异常");
    ERROR_TRAP(value != NULL, "输出参数无效");
    
    // 校验报文ID
    if (frame->id != 0x46C) {
        DBG_PRINT("报文ID不匹配(预期:0x46C, 实际:0x%X)", frame->id);
        return false;
    }
    
    // 提取原始信号值
    uint64_t raw_value = 0;
    // 大端模式处理
    for (int i = 0; i < 1; i++) {
        int byte_pos = 7 - (i / 8);
        int bit_pos = 7 + (i % 8);
        SET_BIT(raw_value, i, GET_BIT(frame->data[byte_pos], bit_pos));
    }
    
    // 应用转换公式：物理值 = (原始值 × 1) + 0
    *value = (raw_value * 1) + 0;
    
    // 边界检查
    if (*value < 0 || *value > 1) {
        DBG_PRINT("信号AC2_St_RemoteControl越界(值:%.2f, 范围:[%.2f~%.2f])", 
                 *value, 0, 1);
        return false;
    }
    
    DBG_PRINT("获取AC2_St_RemoteControl成功: %.2f", *value);
    return true;
}

/*----------------------------------------------------------------*
 * 函数名：Set_AC2_St_RemoteControl
 * 功能：设置空调成功接收到TBOX远程启动空调命令接收到远程启动命令，水温不满足空调启动条件时发送信号值1VM2:预留此信号信号值
 * 参数：
 *   - frame: CAN帧指针
 *   - value: 输入信号值
 * 返回值：操作是否成功
 * 注意：空调成功接收到TBOX远程启动空调命令接收到远程启动命令，水温不满足空调启动条件时发送信号值1VM2:预留此信号
 *----------------------------------------------------------------*/
bool Set_AC2_St_RemoteControl(CAN_Frame* frame, float value) {
    // 边界检查
    if (value < 0 || value > 1) {
        DBG_PRINT("信号AC2_St_RemoteControl越界(值:%.2f, 范围:[%.2f~%.2f])", 
                 value, 0, 1);
        return false;
    }
    
    // 计算原始值：原始值 = (物理值 - 0) / 1
    uint64_t raw_value = (uint64_t)round((value - 0) / 1);
    
    // 设置原始信号值
    // 大端模式处理
    for (int i = 0; i < 1; i++) {
        int byte_pos = 7 - (i / 8);
        int bit_pos = 7 + (i % 8);
        uint8_t bit_val = GET_BIT(raw_value, i);
        SET_BIT(frame->data[byte_pos], bit_pos, bit_val);
    }
    
    // 设置报文ID和长度
    frame->id = 0x46C;
    frame->dlc = 8;
    
    DBG_PRINT("设置AC2_St_RemoteControl成功: %.2f", value);
    return true;
}
/*----------------------------------------------------------------*
 * 函数名：Get_TBOX1_St_FrontDefrost
 * 功能：获取TBOX1_St_FrontDefrost信号值
 * 参数：
 *   - frame: CAN帧指针
 *   - value: 输出信号值指针
 * 返回值：操作是否成功
 * 注意：无特殊说明
 *----------------------------------------------------------------*/
bool Get_TBOX1_St_FrontDefrost(const CAN_Frame* frame, float* value) {
    // 校验输入参数
    ERROR_TRAP(frame != NULL, "空指针异常");
    ERROR_TRAP(value != NULL, "输出参数无效");
    
    // 校验报文ID
    if (frame->id != 0x478) {
        DBG_PRINT("报文ID不匹配(预期:0x478, 实际:0x%X)", frame->id);
        return false;
    }
    
    // 提取原始信号值
    uint64_t raw_value = 0;
    // 大端模式处理
    for (int i = 0; i < 2; i++) {
        int byte_pos = 1 - (i / 8);
        int bit_pos = 5 + (i % 8);
        SET_BIT(raw_value, i, GET_BIT(frame->data[byte_pos], bit_pos));
    }
    
    // 应用转换公式：物理值 = (原始值 × 1) + 0
    *value = (raw_value * 1) + 0;
    
    // 边界检查
    if (*value < 0 || *value > 3) {
        DBG_PRINT("信号TBOX1_St_FrontDefrost越界(值:%.2f, 范围:[%.2f~%.2f])", 
                 *value, 0, 3);
        return false;
    }
    
    DBG_PRINT("获取TBOX1_St_FrontDefrost成功: %.2f", *value);
    return true;
}

/*----------------------------------------------------------------*
 * 函数名：Set_TBOX1_St_FrontDefrost
 * 功能：设置TBOX1_St_FrontDefrost信号值
 * 参数：
 *   - frame: CAN帧指针
 *   - value: 输入信号值
 * 返回值：操作是否成功
 * 注意：无特殊说明
 *----------------------------------------------------------------*/
bool Set_TBOX1_St_FrontDefrost(CAN_Frame* frame, float value) {
    // 边界检查
    if (value < 0 || value > 3) {
        DBG_PRINT("信号TBOX1_St_FrontDefrost越界(值:%.2f, 范围:[%.2f~%.2f])", 
                 value, 0, 3);
        return false;
    }
    
    // 计算原始值：原始值 = (物理值 - 0) / 1
    uint64_t raw_value = (uint64_t)round((value - 0) / 1);
    
    // 设置原始信号值
    // 大端模式处理
    for (int i = 0; i < 2; i++) {
        int byte_pos = 1 - (i / 8);
        int bit_pos = 5 + (i % 8);
        uint8_t bit_val = GET_BIT(raw_value, i);
        SET_BIT(frame->data[byte_pos], bit_pos, bit_val);
    }
    
    // 设置报文ID和长度
    frame->id = 0x478;
    frame->dlc = 8;
    
    DBG_PRINT("设置TBOX1_St_FrontDefrost成功: %.2f", value);
    return true;
}
/*----------------------------------------------------------------*
 * 函数名：Get_TBOX1_St_CLM
 * 功能：获取远程控制空调（VM2预留）信号值
 * 参数：
 *   - frame: CAN帧指针
 *   - value: 输出信号值指针
 * 返回值：操作是否成功
 * 注意：远程控制空调（VM2预留）
 *----------------------------------------------------------------*/
bool Get_TBOX1_St_CLM(const CAN_Frame* frame, float* value) {
    // 校验输入参数
    ERROR_TRAP(frame != NULL, "空指针异常");
    ERROR_TRAP(value != NULL, "输出参数无效");
    
    // 校验报文ID
    if (frame->id != 0x478) {
        DBG_PRINT("报文ID不匹配(预期:0x478, 实际:0x%X)", frame->id);
        return false;
    }
    
    // 提取原始信号值
    uint64_t raw_value = 0;
    // 大端模式处理
    for (int i = 0; i < 2; i++) {
        int byte_pos = 2 - (i / 8);
        int bit_pos = 1 + (i % 8);
        SET_BIT(raw_value, i, GET_BIT(frame->data[byte_pos], bit_pos));
    }
    
    // 应用转换公式：物理值 = (原始值 × 1) + 0
    *value = (raw_value * 1) + 0;
    
    // 边界检查
    if (*value < 0 || *value > 2) {
        DBG_PRINT("信号TBOX1_St_CLM越界(值:%.2f, 范围:[%.2f~%.2f])", 
                 *value, 0, 2);
        return false;
    }
    
    DBG_PRINT("获取TBOX1_St_CLM成功: %.2f", *value);
    return true;
}

/*----------------------------------------------------------------*
 * 函数名：Set_TBOX1_St_CLM
 * 功能：设置远程控制空调（VM2预留）信号值
 * 参数：
 *   - frame: CAN帧指针
 *   - value: 输入信号值
 * 返回值：操作是否成功
 * 注意：远程控制空调（VM2预留）
 *----------------------------------------------------------------*/
bool Set_TBOX1_St_CLM(CAN_Frame* frame, float value) {
    // 边界检查
    if (value < 0 || value > 2) {
        DBG_PRINT("信号TBOX1_St_CLM越界(值:%.2f, 范围:[%.2f~%.2f])", 
                 value, 0, 2);
        return false;
    }
    
    // 计算原始值：原始值 = (物理值 - 0) / 1
    uint64_t raw_value = (uint64_t)round((value - 0) / 1);
    
    // 设置原始信号值
    // 大端模式处理
    for (int i = 0; i < 2; i++) {
        int byte_pos = 2 - (i / 8);
        int bit_pos = 1 + (i % 8);
        uint8_t bit_val = GET_BIT(raw_value, i);
        SET_BIT(frame->data[byte_pos], bit_pos, bit_val);
    }
    
    // 设置报文ID和长度
    frame->id = 0x478;
    frame->dlc = 8;
    
    DBG_PRINT("设置TBOX1_St_CLM成功: %.2f", value);
    return true;
}
/*----------------------------------------------------------------*
 * 函数名：Get_TBOX1_St_ACSetTemp
 * 功能：获取远程空调设置（VM2预留）信号值
 * 参数：
 *   - frame: CAN帧指针
 *   - value: 输出信号值指针
 * 返回值：操作是否成功
 * 注意：远程空调设置（VM2预留）
 *----------------------------------------------------------------*/
bool Get_TBOX1_St_ACSetTemp(const CAN_Frame* frame, float* value) {
    // 校验输入参数
    ERROR_TRAP(frame != NULL, "空指针异常");
    ERROR_TRAP(value != NULL, "输出参数无效");
    
    // 校验报文ID
    if (frame->id != 0x478) {
        DBG_PRINT("报文ID不匹配(预期:0x478, 实际:0x%X)", frame->id);
        return false;
    }
    
    // 提取原始信号值
    uint64_t raw_value = 0;
    // 大端模式处理
    for (int i = 0; i < 5; i++) {
        int byte_pos = 4 - (i / 8);
        int bit_pos = 7 + (i % 8);
        SET_BIT(raw_value, i, GET_BIT(frame->data[byte_pos], bit_pos));
    }
    
    // 应用转换公式：物理值 = (原始值 × 0.5) + 18
    *value = (raw_value * 0.5) + 18;
    
    // 边界检查
    if (*value < 18 || *value > 32) {
        DBG_PRINT("信号TBOX1_St_ACSetTemp越界(值:%.2f, 范围:[%.2f~%.2f])", 
                 *value, 18, 32);
        return false;
    }
    
    DBG_PRINT("获取TBOX1_St_ACSetTemp成功: %.2f", *value);
    return true;
}

/*----------------------------------------------------------------*
 * 函数名：Set_TBOX1_St_ACSetTemp
 * 功能：设置远程空调设置（VM2预留）信号值
 * 参数：
 *   - frame: CAN帧指针
 *   - value: 输入信号值
 * 返回值：操作是否成功
 * 注意：远程空调设置（VM2预留）
 *----------------------------------------------------------------*/
bool Set_TBOX1_St_ACSetTemp(CAN_Frame* frame, float value) {
    // 边界检查
    if (value < 18 || value > 32) {
        DBG_PRINT("信号TBOX1_St_ACSetTemp越界(值:%.2f, 范围:[%.2f~%.2f])", 
                 value, 18, 32);
        return false;
    }
    
    // 计算原始值：原始值 = (物理值 - 18) / 0.5
    uint64_t raw_value = (uint64_t)round((value - 18) / 0.5);
    
    // 设置原始信号值
    // 大端模式处理
    for (int i = 0; i < 5; i++) {
        int byte_pos = 4 - (i / 8);
        int bit_pos = 7 + (i % 8);
        uint8_t bit_val = GET_BIT(raw_value, i);
        SET_BIT(frame->data[byte_pos], bit_pos, bit_val);
    }
    
    // 设置报文ID和长度
    frame->id = 0x478;
    frame->dlc = 8;
    
    DBG_PRINT("设置TBOX1_St_ACSetTemp成功: %.2f", value);
    return true;
}
/*----------------------------------------------------------------*
 * 函数名：Get_AC4_Checksum
 * 功能：获取Checksum信号值
 * 参数：
 *   - frame: CAN帧指针
 *   - value: 输出信号值指针
 * 返回值：操作是否成功
 * 注意：Checksum
 *----------------------------------------------------------------*/
bool Get_AC4_Checksum(const CAN_Frame* frame, float* value) {
    // 校验输入参数
    ERROR_TRAP(frame != NULL, "空指针异常");
    ERROR_TRAP(value != NULL, "输出参数无效");
    
    // 校验报文ID
    if (frame->id != 0x57C) {
        DBG_PRINT("报文ID不匹配(预期:0x57C, 实际:0x%X)", frame->id);
        return false;
    }
    
    // 提取原始信号值
    uint64_t raw_value = 0;
    // 大端模式处理
    for (int i = 0; i < 8; i++) {
        int byte_pos = 0 - (i / 8);
        int bit_pos = 7 + (i % 8);
        SET_BIT(raw_value, i, GET_BIT(frame->data[byte_pos], bit_pos));
    }
    
    // 应用转换公式：物理值 = (原始值 × 1) + 0
    *value = (raw_value * 1) + 0;
    
    // 边界检查
    if (*value < 0 || *value > 255) {
        DBG_PRINT("信号AC4_Checksum越界(值:%.2f, 范围:[%.2f~%.2f])", 
                 *value, 0, 255);
        return false;
    }
    
    DBG_PRINT("获取AC4_Checksum成功: %.2f", *value);
    return true;
}

/*----------------------------------------------------------------*
 * 函数名：Set_AC4_Checksum
 * 功能：设置Checksum信号值
 * 参数：
 *   - frame: CAN帧指针
 *   - value: 输入信号值
 * 返回值：操作是否成功
 * 注意：Checksum
 *----------------------------------------------------------------*/
bool Set_AC4_Checksum(CAN_Frame* frame, float value) {
    // 边界检查
    if (value < 0 || value > 255) {
        DBG_PRINT("信号AC4_Checksum越界(值:%.2f, 范围:[%.2f~%.2f])", 
                 value, 0, 255);
        return false;
    }
    
    // 计算原始值：原始值 = (物理值 - 0) / 1
    uint64_t raw_value = (uint64_t)round((value - 0) / 1);
    
    // 设置原始信号值
    // 大端模式处理
    for (int i = 0; i < 8; i++) {
        int byte_pos = 0 - (i / 8);
        int bit_pos = 7 + (i % 8);
        uint8_t bit_val = GET_BIT(raw_value, i);
        SET_BIT(frame->data[byte_pos], bit_pos, bit_val);
    }
    
    // 设置报文ID和长度
    frame->id = 0x57C;
    frame->dlc = 8;
    
    DBG_PRINT("设置AC4_Checksum成功: %.2f", value);
    return true;
}
/*----------------------------------------------------------------*
 * 函数名：Get_AC4_Front_EVAP_Temp
 * 功能：获取AC4_Front_EVAP_Temp信号值
 * 参数：
 *   - frame: CAN帧指针
 *   - value: 输出信号值指针
 * 返回值：操作是否成功
 * 注意：无特殊说明
 *----------------------------------------------------------------*/
bool Get_AC4_Front_EVAP_Temp(const CAN_Frame* frame, float* value) {
    // 校验输入参数
    ERROR_TRAP(frame != NULL, "空指针异常");
    ERROR_TRAP(value != NULL, "输出参数无效");
    
    // 校验报文ID
    if (frame->id != 0x57C) {
        DBG_PRINT("报文ID不匹配(预期:0x57C, 实际:0x%X)", frame->id);
        return false;
    }
    
    // 提取原始信号值
    uint64_t raw_value = 0;
    // 大端模式处理
    for (int i = 0; i < 11; i++) {
        int byte_pos = 5 - (i / 8);
        int bit_pos = 7 + (i % 8);
        SET_BIT(raw_value, i, GET_BIT(frame->data[byte_pos], bit_pos));
    }
    
    // 应用转换公式：物理值 = (原始值 × 1) + -40
    *value = (raw_value * 1) + -40;
    
    // 边界检查
    if (*value < -40 || *value > 80) {
        DBG_PRINT("信号AC4_Front_EVAP_Temp越界(值:%.2f, 范围:[%.2f~%.2f])", 
                 *value, -40, 80);
        return false;
    }
    
    DBG_PRINT("获取AC4_Front_EVAP_Temp成功: %.2f℃", *value);
    return true;
}

/*----------------------------------------------------------------*
 * 函数名：Set_AC4_Front_EVAP_Temp
 * 功能：设置AC4_Front_EVAP_Temp信号值
 * 参数：
 *   - frame: CAN帧指针
 *   - value: 输入信号值
 * 返回值：操作是否成功
 * 注意：无特殊说明
 *----------------------------------------------------------------*/
bool Set_AC4_Front_EVAP_Temp(CAN_Frame* frame, float value) {
    // 边界检查
    if (value < -40 || value > 80) {
        DBG_PRINT("信号AC4_Front_EVAP_Temp越界(值:%.2f, 范围:[%.2f~%.2f])", 
                 value, -40, 80);
        return false;
    }
    
    // 计算原始值：原始值 = (物理值 - -40) / 1
    uint64_t raw_value = (uint64_t)round((value - -40) / 1);
    
    // 设置原始信号值
    // 大端模式处理
    for (int i = 0; i < 11; i++) {
        int byte_pos = 5 - (i / 8);
        int bit_pos = 7 + (i % 8);
        uint8_t bit_val = GET_BIT(raw_value, i);
        SET_BIT(frame->data[byte_pos], bit_pos, bit_val);
    }
    
    // 设置报文ID和长度
    frame->id = 0x57C;
    frame->dlc = 8;
    
    DBG_PRINT("设置AC4_Front_EVAP_Temp成功: %.2f℃", value);
    return true;
}
