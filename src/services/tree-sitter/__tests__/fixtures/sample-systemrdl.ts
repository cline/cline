export default String.raw`
// Component definition test - showing register block
addrmap top_map {
    name = "Top Level Address Map";
    desc = "Example SystemRDL address map";
    
    reg block_ctrl {
        name = "Block Control Register";
        desc = "Control register for the block";
        
        field {
            name = "Enable";
            desc = "Block enable bit";
            sw = rw;
            hw = r;
        } enable[1:0];
        
        field {
            name = "Status";
            desc = "Block status";
            sw = r;
            hw = w;
        } status;
    };
};

// Field definition test with properties
reg status_reg {
    field {
        name = "Error Flags";
        sw = rw;
        hw = w;
        reset = 0x0;
        
        enum error_types {
            NO_ERROR = 0;
            TIMEOUT = 1;
            OVERFLOW = 2;
            UNDERFLOW = 3;
        };
    } errors[3:0];
};

// Property definition test
property my_custom_prop {
    type = string;
    component = reg;
    default = "undefined";
};

// Parameter definition test
parameter DATA_WIDTH {
    type = longint unsigned;
    default = 32;
};

// Enum definition test
enum interrupt_type {
    LEVEL = 0 { desc = "Level-triggered interrupt"; };
    EDGE = 1 { desc = "Edge-triggered interrupt"; };
};

// Complex register with multiple fields
reg complex_reg {
    name = "Complex Register";
    desc = "Register with multiple fields";
    
    field {
        name = "Control";
        sw = rw;
        hw = r;
    } ctrl[7:0];
    
    field {
        name = "Status";
        sw = r;
        hw = w;
    } status[15:8];
    
    field {
        name = "Flags";
        sw = rw1c;
        hw = w;
    } flags[23:16];
};
`
