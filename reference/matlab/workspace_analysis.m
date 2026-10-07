close all; clear; clc;

% Read the data from CSV file

T = readtable("./training/data/2024_02_19_21_08_57/positions_norm_full.csv");

% Extract X, Y, and Z data points
X = (T.x_end_avg).*1000; 
Y = (T.y_end_avg).*1000;
Z = (T.z_end_avg).*1000;

quat = [T.qw_end_avg,T.qx_end_avg,T.qy_end_avg,T.qz_end_avg];
quat = quaternion(quat);
pose_dist = xy_dist(quat);
pose_dist = rad2deg(pose_dist);
quat_new = convert_quat(quat);

map = brewermap(9,'Set1');

%% Find point density in data

save_density = false;

X_m = reshape(X,100,[]);
Y_m = reshape(Y,100,[]);
Z_m = reshape(Z,100,[]);

dX_m = diff(X_m);
dY_m = diff(Y_m);
dZ_m = diff(Z_m);

% Calculate the Euclidean distances between consecutive points
distances = sum(sqrt(dX_m.^2 + dY_m.^2 + dZ_m.^2),1);

dist_per_point = 100./mean(distances);

if save_density
    save('./training/state/point_density.mat','dist_per_point')
end

%% Save home pos
save_home = false;

quat_home = quat(1:100:end);
quat_bar = meanrot(quat_home,1);
xyz_home = [X(1:100:end),Y(1:100:end),Z(1:100:end)];
xyz_bar = mean(xyz_home,1);
pos = [xyz_bar,compact(quat_bar)];

if save_home
    save('./training/state/home_measured.mat','pos')
end

%% Histogram of tilt
figure(1); clf; hold on;

hist(pose_dist)
ylabel('Count')
xlabel('Tilt (degree)')

%% Visualize the pose
n = 100;

plot_triad(X(1:n),Y(1:n),Z(1:n),quat_new(1:n))

%% Poses that are close to normal to the plane
% pose_slice = (pose_dist < 7.5);
% pose_slice = (pose_dist < 60 & pose_dist > 30);
pose_slice = (pose_dist > 70);

% fig sizes and scale factor
fig_w = 300; fig_h = 300; fig_s = 3;

% fonts
ax_font_size = 5*fig_s;
legend_font_size = 5*fig_s;
set(0,'DefaultTextFontname', 'CMU Sans Serif' )
set(0,'DefaultAxesFontName', 'CMU Sans Serif' )

% colors
map = brewermap(9,'Set1');

home_pos = load('./training/state/home_measured.mat').pos;

figure(1); clf; hold on; box on; grid on; axis equal;

% figure formatting
set(gcf,'color','w');
set(gcf, 'Units', 'inches');
width = 1.25;
height = 1;
set(gcf, 'Position', [0, 0, width*fig_s, height*fig_s]);
% axis formatting
set(findobj(gcf,'type','axes'),'FontSize',ax_font_size,'LineWidth',1.5);

xlim([-375,375])
ylim([-375,375])
zlim([-5,300])

scatter3(X(pose_slice)-home_pos(1),Y(pose_slice)-home_pos(2),Z(pose_slice)-home_pos(3),[],"filled",'MarkerFaceColor',map(3,:),'MarkerEdgeColor','k','lineWidth',1)
view(0,90)

exportgraphics(gcf,'../figures/workspace/tilt_xy.png','Resolution', 300);

view(0,0)

width = 1.05;
height = 1;
set(gcf, 'Position', [0, 0, width*fig_s, height*fig_s]);

exportgraphics(gcf,'../figures/workspace/tilt_zx.png','Resolution', 300);

%% Helper functions

function angles = xy_dist(quaternions)
    % Initialize the angles array
    angles = zeros(size(quaternions, 1), 1);
    
    % Reference up-vector (local Z-axis)
    upVector = [0; 0; 1];
    
    for idx = 1:size(quaternions, 1)
        % Extract the quaternion
        q = quaternions(idx, :);
        
        % Convert quaternion to rotation matrix
        R = quat2rotm(q);
        
        % Rotate the up-vector
        rotatedVector = R * upVector;
        
        % Calculate the angle with the Z-axis (dot product)
        cosTheta = dot(rotatedVector, [0; 0; 1]) / norm(rotatedVector);
        % Ensure the value is within the valid range for acos
        cosTheta = max(min(cosTheta, 1), -1);
        angle = acos(cosTheta);
        
        % Store the angle
        angles(idx) = angle;
    end
end


function R = rotx(theta)
    % Define the rotation matrix
    R = [1, 0, 0;
         0, cos(theta), -sin(theta);
         0, sin(theta), cos(theta)];
end

function R = roty(theta)
    % Define the rotation matrix
    R = [cos(theta), 0, sin(theta);
         0, 1, 0;
         -sin(theta), 0, cos(theta)];
end

function R = rotz(theta)
    % Define the rotation matrix
    R = [cos(theta), -sin(theta), 0;
         sin(theta), cos(theta), 0;
         0, 0, 1];
end


function q_new = convert_quat(q)

q_new = zeros(length(q),4);

for idx = 1:length(q)
    e = quat2eul(q(idx),'XYZ');
    rx = rotx(e(1));
    ry = roty(e(2));
    rz = rotz(e(3));
    r_new = rx*ry*rz;
    q_new(idx,:) = rotm2quat(r_new);
end

q_new = quaternion(q_new);

end

function plot_triad(x, y, z, q)
    % fig sizes and scale factor
    fig_w = 300; fig_h = 300; fig_s = 3;
    
    % fonts
    ax_font_size = 5*fig_s;
    legend_font_size = 5*fig_s;
    set(0,'DefaultTextFontname', 'CMU Sans Serif' )
    set(0,'DefaultAxesFontName', 'CMU Sans Serif' )
    
    % colors
    map = brewermap(9,'Set1');

    home_pos = load('./training/state/home_measured.mat').pos;

    x = x-home_pos(1);
    y = y-home_pos(2);
    z = z-home_pos(3);

    figure(1); clf; hold on; box on; grid on; axis equal;
    
    arrowLength = 40; % Adjust the arrow length as needed
    headSize = 20;
        

    for i = 1:length(x)
        % Convert quaternion to rotation matrix
        R = quat2rotm(q(i,:));
        
        % Origin for the triad
        origin = [x(i), y(i), z(i)];
        
        % Directions for the triad arrows, transformed by R
        xDir = R(:,1)';
        yDir = R(:,2)';
        zDir = R(:,3)';
        
        % Plot arrows
        quiver3(origin(1), origin(2), origin(3), xDir(1), xDir(2), xDir(3), arrowLength, 'r', 'LineWidth', 1, 'MaxHeadSize', headSize);
        quiver3(origin(1), origin(2), origin(3), yDir(1), yDir(2), yDir(3), arrowLength, 'g', 'LineWidth', 1, 'MaxHeadSize', headSize);
        quiver3(origin(1), origin(2), origin(3), zDir(1), zDir(2), zDir(3), arrowLength, 'b', 'LineWidth', 1, 'MaxHeadSize', headSize);
    end
    
    hold off;

    % figure formatting
    set(gcf,'color','w');
    set(gcf, 'Units', 'inches');
    width = 1.25;
    height = 1;
    set(gcf, 'Position', [0, 0, width*fig_s, height*fig_s]);
    xlim([-325,325])
    ylim([-325,325])
    zlim([-5,275])
    % axis formatting
    set(findobj(gcf,'type','axes'),'FontSize',ax_font_size,'LineWidth',1.5);

    view(0,90)
    
end