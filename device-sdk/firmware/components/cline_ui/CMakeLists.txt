if(CONFIG_DEVICE_SURFACE_EPAPER)
    set(surface_sources "epaper/gfx.c" "epaper/surface.c")
elseif(CONFIG_DEVICE_SURFACE_COLOR)
    set(surface_sources "color/surface.c")
elseif(NOT CMAKE_BUILD_EARLY_EXPANSION)
    message(FATAL_ERROR "No renderer for the selected board")
endif()
idf_component_register(SRCS "assets/animations.c" ${surface_sources} INCLUDE_DIRS "include" PRIV_INCLUDE_DIRS "assets" "epaper" REQUIRES cline_model cline_board)

# Compile the board's selected variant into its own build directory. The browser
# reads the same manifest directly; there is no checked-in generated C copy.
if(NOT CMAKE_BUILD_EARLY_EXPANSION)
    set(avatar_root "${CMAKE_CURRENT_SOURCE_DIR}/../../../assets/avatars")
    set(sprite_tool "${CMAKE_CURRENT_SOURCE_DIR}/../../tools/sprites.py")
    set(sprite_header "${CMAKE_CURRENT_BINARY_DIR}/generated/sprites.h")
    file(GLOB_RECURSE avatar_inputs CONFIGURE_DEPENDS "${avatar_root}/*")
    idf_build_get_property(python PYTHON)
    add_custom_command(
        OUTPUT "${sprite_header}"
        COMMAND "${python}" "${sprite_tool}" --board "${CONFIG_DEVICE_BOARD_ID}"
                --avatar "${CONFIG_DEVICE_AVATAR_ID}" --output "${sprite_header}"
        DEPENDS "${sprite_tool}" ${avatar_inputs}
        VERBATIM
    )
    target_sources(${COMPONENT_LIB} PRIVATE "${sprite_header}")
    target_include_directories(${COMPONENT_LIB} PRIVATE "${CMAKE_CURRENT_BINARY_DIR}/generated")
endif()
