clear all; close all; clc;
addpath('./util/')

% Create an instance of the arm and motor
motor = armMotor();

arm = robotArm();
arm.reset_arm()
 
%% Find home position

set_home = true;

home = [80,94,91,...
        55,92,81,...
        63,83,83];
arm.set_pos(home)

if set_home
    save('./state/home',"home");
end

%% Verify compression

set_comp = false;

home = load('./state/home').home;
delta_l = -80;
comp_delta = repmat(delta_l.*[1,5/7,3/7],[1,3]);
comp = home + comp_delta;

arm.set_pos(comp);

if set_comp
    save('./state/comp',"comp");
end


%% Set max compression

set_comp = true;

home = load('./state/home').home;
delta_l = -70;
comp_delta = repmat(delta_l.*[1,5/7,3/7],[1,3]);
comp_max = home + comp_delta;

arm.set_pos(comp_max);

if set_comp
    save('./state/comp_max',"comp_max");
end

%%  Motor

motor.pulse(1)

%% Optitrack

tool = arm.get_pose();
disp(tool)
pos = [tool.x*1000,tool.y*1000,tool.z*1000,tool.qw,tool.qx,tool.qy,tool.qz];

%% Turn off motors

arm.stop_motors()