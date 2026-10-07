close all; clc; clear all;
addpath('./util')

save_output = false;

syms theta_1 theta_2 theta_3 theta_4 theta_5 theta_6 L d_tool

% Shoulder
T_shoulder_local = Segment_transform(theta_1,theta_2,-3.*L./7);
T_shoulder = T_shoulder_local;

% Elbow
T_elbow_local = Segment_transform(theta_3,theta_4,-2.*L./7);
T_elbow = T_shoulder*T_elbow_local;

% Wrist
T_wrist_local = Segment_transform(theta_5,theta_6,-2.*L./7);
T_wrist = T_elbow*T_wrist_local;

% Tool
T_tool_local = Segment_transform(0,0,-d_tool);
T_tool = T_wrist*T_tool_local;

%% Visualize arm config

% Shoulder
theta_1_n = deg2rad(20);
theta_2_n = deg2rad(0);

% Elbow
theta_3_n = deg2rad(20);
theta_4_n = deg2rad(0);

% Wrist
theta_5_n = deg2rad(40);
theta_6_n = deg2rad(0);

% Lengths
L_n = 710-15;
d_tool_n = 83;

% Numerical substituion
T_shoulder_n = double(subs(T_shoulder,[theta_1, theta_2, theta_3, theta_4, theta_5, theta_6, L, d_tool],...
                    [theta_1_n, theta_2_n, theta_3_n, theta_4_n, theta_5_n, theta_6_n, L_n, d_tool_n]));
T_elbow_n = double(subs(T_elbow,[theta_1, theta_2, theta_3, theta_4, theta_5, theta_6, L, d_tool],...
                    [theta_1_n, theta_2_n, theta_3_n, theta_4_n, theta_5_n, theta_6_n, L_n, d_tool_n]));
T_wrist_n = double(subs(T_wrist,[theta_1, theta_2, theta_3, theta_4, theta_5, theta_6, L, d_tool],...
                    [theta_1_n, theta_2_n, theta_3_n, theta_4_n, theta_5_n, theta_6_n, L_n, d_tool_n]));
T_tool_n = double(subs(T_tool,[theta_1, theta_2, theta_3, theta_4, theta_5, theta_6, L, d_tool],...
                    [theta_1_n, theta_2_n, theta_3_n, theta_4_n, theta_5_n, theta_6_n, L_n, d_tool_n]));

% Visualize arm
[segments] = draw_arm(T_shoulder_n,T_elbow_n,T_wrist_n,T_tool_n);

comp_segments = load('./state/model_comp.mat').segments;
delta_segments = segments-comp_segments

%% Sweep over configuration space

% Number of points
n = 100;

% Configuration boundries 
theta_max_shoulder = deg2rad(50);
theta_max_elbow = deg2rad(50);
theta_max_wrist = deg2rad(40);
dL_max = 70;

% Seed our sweep
rng(8);

% Shoulder
t_1_sweep = [0;theta_max_shoulder.*2.*(rand(n-1,1)-1/2)];
t_2_sweep = [0;theta_max_shoulder.*2.*(rand(n-1,1)-1/2)];

% Elbow
t_3_sweep = t_1_sweep;
t_4_sweep = t_2_sweep;

% Wrist
t_5_sweep = [0;theta_max_wrist.*2.*(rand(n-1,1)-1/2)];
t_6_sweep = [0;theta_max_wrist.*2.*(rand(n-1,1)-1/2)];

% Lengths
L_sweep = [690; 690 - dL_max.*rand(n-1,1)];
d_tool_sweep = 83;

% Store position we are visiting
X = zeros(size(L_sweep));
Y = zeros(size(L_sweep));
Z = zeros(size(L_sweep));

% Store lengths for our sweep
model_comp = load('./state/model_comp').lengths;
lengths_sweep = zeros(n,length(model_comp));

for i = 1:n
    % Shoulder
    T_shoulder_local = Segment_transform(t_1_sweep(i),t_2_sweep(i),-3.*L_sweep(i)./7);
    T_shoulder_sweep = T_shoulder_local;
    
    % Elbow
    T_elbow_local = Segment_transform(t_3_sweep(i),t_4_sweep(i),-2.*L_sweep(i)./7);
    T_elbow_sweep = T_shoulder_sweep*T_elbow_local;
    
    % Wrist
    T_wrist_local = Segment_transform(t_5_sweep(i),t_6_sweep(i),-2.*L_sweep(i)./7);
    T_wrist_sweep = T_elbow_sweep*T_wrist_local;
    
    % Tool
    T_tool_local = Segment_transform(0,0,-d_tool_sweep);
    T_tool_sweep = T_wrist_sweep*T_tool_local;

    % Collect segments and cables
    [segments,lengths] = cable_space(T_shoulder_sweep,T_elbow_sweep,T_wrist_sweep,T_tool_sweep);
    delta_length = lengths-model_comp;
    lengths_sweep(i,:) = delta_length;

    % Store end effector position
    X(i) = T_tool_sweep(1,4);
    Y(i) = T_tool_sweep(2,4);
    Z(i) = T_tool_sweep(3,4);
end

tool_pos = [X,Y,Z];
geo = [t_1_sweep,t_2_sweep,t_3_sweep,t_4_sweep,t_5_sweep,t_6_sweep,L_sweep];
plot3(X(1:100),Y(1:100),Z(1:100))

%% Greedy solution to TSP
map = brewermap(9,'Set1');

delta_fast = zeros(size(lengths_sweep));
delta_fast(1,:) = lengths_sweep(1,:);
tool_pos_fast = zeros(size(tool_pos));
tool_pos_fast(1,:) = tool_pos(1,:);
geo_fast = zeros(size(geo));

% Keep track of which answers to exclude
exclude = true(size(tool_pos,1),1);
exclude(1) = false;

for i = 1:size(tool_pos_fast,1)-1
    % Keep track of original indices
    original_idx = find(exclude);
    
    tool_trim = tool_pos(exclude,:);
    idx = knnsearch(tool_trim,tool_pos_fast(i,:));
    
    % Update indices
    original_idx_selected = original_idx(idx);
    
    tool_pos_fast(i+1,:) = tool_pos(original_idx_selected,:);
    delta_fast(i+1,:) = lengths_sweep(original_idx_selected,:);
    geo_fast(i+1,:) = geo(original_idx_selected,:);
    exclude(original_idx_selected) = false;
end

fast_diff = sqrt(sum(diff(tool_pos_fast).^2,2));
regular_diff = sqrt(sum(diff(tool_pos).^2,2));

mean(fast_diff)
mean(regular_diff)

fig = figure(1); clf; hold on;
set(gcf,'color','w');
set(gcf,'position',[0,0,600,600])
set(gca,'fontsize',14);
ax = gca;
grid on; grid minor;
set(get(fig,'CurrentAxes'),'GridAlpha',1,'MinorGridAlpha',0.7);
plot(fast_diff,'lineWidth',3,'Color',map(1,:));
plot(regular_diff,'lineWidth',3,'Color',map(2,:));
legend(["Greedy KNN","random"])
xlabel("Data point index",fontSize=14)
ylabel("Total tool displacment",fontSize=14)


fig = figure(2); clf; hold on;
set(gcf,'color','w');
set(gcf,'position',[0,0,600,600])
set(gca,'fontsize',14);
ax = gca;
grid on; grid minor;
set(get(fig,'CurrentAxes'),'GridAlpha',1,'MinorGridAlpha',0.7);
plot3(tool_pos_fast(:,1),tool_pos_fast(:,2),tool_pos_fast(:,3),'lineWidth',3,'Color',map(1,:));
xlabel("Data point index",fontSize=14)
ylabel("Total tool displacment",fontSize=14)


% Save output
if save_output
    if (length(tool_pos_fast) < 5000)
        save("./trajectory/delta_fast_repeat.mat","delta_fast")
        save("./trajectory/geo_fast_repeat.mat","geo_fast")
        writematrix(delta_fast,"./trajectory/delta_fast_repeat.csv")
        writematrix(geo_fast,"./trajectory/geo_fast_repeat.csv")
    else
        save("./trajectory/delta_fast.mat","delta_fast")
        save("./trajectory/geo_fast.mat","geo_fast")
        writematrix(delta_fast,"./trajectory/delta_fast.csv")
        writematrix(geo_fast,"./trajectory/geo_fast.csv")
    end
end
%% Helper functions

function T = Segment_transform(theta_1,theta_2,d)
Rx = [1,0,0,0;
      0,cos(theta_1),-sin(theta_1),0;
      0,sin(theta_1),cos(theta_1),0;
      0,0,0,1];
Ry = [cos(theta_2),0,sin(theta_2),0;
      0,1,0,0;
      -sin(theta_2),0,cos(theta_2),0;
      0,0,0,1];
Rz = [cos(theta_2),-sin(theta_2),0,0;
      sin(theta_2),cos(theta_2),0,0;
      0,0,1,0;
      0,0,0,1];
Rz_m = [cos(-theta_2),-sin(-theta_2),0,0;
      sin(-theta_2),cos(-theta_2),0,0;
      0,0,1,0;
      0,0,0,1];
Tz = [1,0,0,0;
      0,1,0,0;
      0,0,1,d;
      0,0,0,1];
T = Rz_m*Tz*Rx*Rz;
end

function [segments] = cable_space(T_shoulder_n,T_elbow_n,T_wrist_n,T_tool_n)
    % Plot triangles
    tri_origin = [0,65.*sin(pi/3),-65.*sin(pi/3),0,;
                65,-65.*cos(pi/3),-65.*cos(pi/3),65;
                0,0,0,0;
                1,1,1,1];
    tri_shoulder = T_shoulder_n*tri_origin;
    tri_elbow = T_elbow_n*tri_origin;
    tri_wrist = T_wrist_n*tri_origin;

    % Find segment lengths
    s_shoulder = sqrt(sum((tri_shoulder(1:3,1:3)-tri_origin(1:3,1:3)).^2,1));
    s_elbow = sqrt(sum((tri_elbow(1:3,1:3)-tri_shoulder(1:3,1:3)).^2,1));
    s_wrist = sqrt(sum((tri_wrist(1:3,1:3)-tri_elbow(1:3,1:3)).^2,1));
    
    s1_s = s_shoulder(1); s2_s = s_shoulder(2); s3_s = s_shoulder(3);
    s1_e = s_elbow(1); s2_e = s_elbow(2); s3_e = s_elbow(3);
    s1_w = s_wrist(1); s2_w = s_wrist(2); s3_w = s_wrist(3);
    segments = [s1_w,s1_e,s1_s,s2_w,s2_e,s2_s,s3_w,s3_e,s3_s];
end

% Helper function for drawing arm
function [segments] = draw_arm(T_shoulder_n,T_elbow_n,T_wrist_n,T_tool_n)
    % Plot of the arm
    figure(1); clf; hold on
    set(gcf, 'Color', 'white');

    % Plot triangles
    tri_origin = [0,65.*sin(pi/3),-65.*sin(pi/3),0,;
                65,-65.*cos(pi/3),-65.*cos(pi/3),65;
                0,0,0,0;
                1,1,1,1];
    tri_shoulder = T_shoulder_n*tri_origin;
    tri_elbow = T_elbow_n*tri_origin;
    tri_wrist = T_wrist_n*tri_origin;

    plot3(tri_origin(1,:),tri_origin(2,:),tri_origin(3,:),'Color',[0.5,0.5,0.5,0.5],'LineWidth',3)
    plot3(tri_shoulder(1,:),tri_shoulder(2,:),tri_shoulder(3,:),'Color',[0.5,0.5,0.5,0.5],'LineWidth',3)
    plot3(tri_elbow(1,:),tri_elbow(2,:),tri_elbow(3,:),'Color',[0.5,0.5,0.5,0.5],'LineWidth',3)
    plot3(tri_wrist(1,:),tri_wrist(2,:),tri_wrist(3,:),'Color',[0.5,0.5,0.5,0.5],'LineWidth',3)

    % Plot of cables
    plot3([tri_origin(1,1),tri_shoulder(1,1),tri_elbow(1,1),tri_wrist(1,1)],...
          [tri_origin(2,1),tri_shoulder(2,1),tri_elbow(2,1),tri_wrist(2,1)],...
          [tri_origin(3,1),tri_shoulder(3,1),tri_elbow(3,1),tri_wrist(3,1)],'Color','k','LineWidth',2)
    plot3([tri_origin(1,2),tri_shoulder(1,2),tri_elbow(1,2),tri_wrist(1,2)],...
          [tri_origin(2,2),tri_shoulder(2,2),tri_elbow(2,2),tri_wrist(2,2)],...
          [tri_origin(3,2),tri_shoulder(3,2),tri_elbow(3,2),tri_wrist(3,2)],'Color','k','LineWidth',2)
    plot3([tri_origin(1,3),tri_shoulder(1,3),tri_elbow(1,3),tri_wrist(1,3)],...
          [tri_origin(2,3),tri_shoulder(2,3),tri_elbow(2,3),tri_wrist(2,3)],...
          [tri_origin(3,3),tri_shoulder(3,3),tri_elbow(3,3),tri_wrist(3,3)],'Color','k','LineWidth',2)

    % Find segment lengths
    s_shoulder = sqrt(sum((tri_shoulder(1:3,1:3)-tri_origin(1:3,1:3)).^2,1));
    s_elbow = sqrt(sum((tri_elbow(1:3,1:3)-tri_shoulder(1:3,1:3)).^2,1));
    s_wrist = sqrt(sum((tri_wrist(1:3,1:3)-tri_elbow(1:3,1:3)).^2,1));
    
    s1_s = s_shoulder(1); s2_s = s_shoulder(2); s3_s = s_shoulder(3);
    s1_e = s_elbow(1); s2_e = s_elbow(2); s3_e = s_elbow(3);
    s1_w = s_wrist(1); s2_w = s_wrist(2); s3_w = s_wrist(3);
    segments = [s1_w,s1_e,s1_s,s2_w,s2_e,s2_s,s3_w,s3_e,s3_s];
    
    % Plot joints
    r = 30;
    [X, Y, Z] = sphere(100);
    X = r * X; Y = r * Y; Z = r * Z;
    
    surf(X+T_shoulder_n(1,4), Y+T_shoulder_n(2,4), Z+T_shoulder_n(3,4),'FaceColor','r','EdgeColor','none');
    surf(X+T_elbow_n(1,4), Y+T_elbow_n(2,4), Z+T_elbow_n(3,4),'FaceColor','r','EdgeColor','none');
    surf(X+T_wrist_n(1,4), Y+T_wrist_n(2,4), Z+T_wrist_n(3,4),'FaceColor','r','EdgeColor','none');
    
    % Plot of links
    plot3([0,T_shoulder_n(1,4)],[0,T_shoulder_n(2,4)],[0,T_shoulder_n(3,4)],'LineWidth',4,'Color','k')
    plot3([T_shoulder_n(1,4),T_elbow_n(1,4)],[T_shoulder_n(2,4),T_elbow_n(2,4)],[T_shoulder_n(3,4),T_elbow_n(3,4)],'LineWidth',4,'Color','k')
    plot3([T_elbow_n(1,4),T_wrist_n(1,4)],[T_elbow_n(2,4),T_wrist_n(2,4)],[T_elbow_n(3,4),T_wrist_n(3,4)],'LineWidth',4,'Color','k')
    plot3([T_wrist_n(1,4),T_tool_n(1,4)],[T_wrist_n(2,4),T_tool_n(2,4)],[T_wrist_n(3,4),T_tool_n(3,4)],'LineWidth',4,'Color','k')
    
    % Visualize the origin triad
    hold on; % Keep the current plot
    quiver3(0, 0, 0, 100, 0, 0, 'r',LineWidth=3); % X-axis in red
    quiver3(0, 0, 0, 0, 100, 0, 'b',LineWidth=3); % Y-axis in green
    quiver3(0, 0, 0, 0, 0, 100, 'g',LineWidth=3); % Z-axis in blue
    hold off;
    
    % Adjust the camera view
    view(0, 15); % Set the azimuth and elevation
    
    % Other plot settings
    axis equal; % Equal scaling for all axes
    xlabel('X');
    ylabel('Y');
    zlabel('Z');
    
    % Add lighting to enhance 3D effect
    camlight left;
    lighting phong;
    grid on;
    
    xlim([-500, 500])
    ylim([-500, 500])
    zlim([-800 100])
    
    set(gcf, 'Position', [100, 100, 800, 800]);
    ax = gca;
    ax.FontSize = 14;
    ax.LineWidth = 2;
end