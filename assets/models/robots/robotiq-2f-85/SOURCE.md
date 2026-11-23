# Robotiq 2F-85 model source

The visual meshes and Xacro files in this directory come from the archived
Robotiq ROS package:

- Repository: https://github.com/ros-industrial-attic/robotiq
- Branch: `kinetic-devel`
- Revision: `45196f6558fe8ba9d89bc8a105396c68c3e7e892`
- Original package: `robotiq_2f_85_gripper_visualization`

The DAE mesh files are copied from `meshes/visual/` without geometry changes.
The runtime applies the `0.001` mesh scale declared by the Xacro. The copied
Xacro files document the original joint origins and mimic relationships.

The upstream repository and package declare the BSD 2-Clause license. See
`LICENSE` for the complete terms.
