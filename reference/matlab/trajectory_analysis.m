close all; clear all; clc;
warning('off', 'all');

home_pos = load('./training/state/home_measured.mat').pos;

export_fig = false;

lw = 2;
ms = 8;
gw = 1.5;

map = brewermap(9,'Set1');


%% Plotting out trajectory runs (circle)

% DNN
exp_DNN = 'circle_2024_02_21_15_16_35';
motor_inputs = load(['./training/experiments/',exp_DNN,'/DNN_circle_trajectory_inputs.mat']).output;
wp_DNN = load(['./training/experiments/',exp_DNN,'/circle_trajectory.mat']).wp;
T_DNN = readtable(['./training/experiments/',exp_DNN,'/positions.csv']);

circle_seconds = find_seconds(T_DNN.dateAndTime);

ref_quat = [wp_DNN(:,7),wp_DNN(:,4),wp_DNN(:,5),wp_DNN(:,6)];
measured_quat = [T_DNN.qw_end_avg,T_DNN.qx_end_avg,T_DNN.qy_end_avg,T_DNN.qz_end_avg];
measured_quat = remove_twist(measured_quat);
circle_orientation_error = rad2deg(dist(quaternion(ref_quat),quaternion(measured_quat)));
circle_position_error = sqrt(sum((wp_DNN(:,1:3)-(1000.*[T_DNN.x_end_avg,T_DNN.y_end_avg,T_DNN.z_end_avg])).^2,2)); 

figure(1); clf;
hold on; axis equal; box on; grid on;
set(gcf, 'Color', 'white');
set(gcf,'Units', 'inches','Position',[1,1,3.5,3]); % Adjusted for 2x1 layout

% View 1: XY
xlim([-100,100]);
ylim([-100,100]);

x = -(T_DNN.y_end_avg.*1000-home_pos(2));
y = T_DNN.x_end_avg.*1000-home_pos(1);
z = T_DNN.z_end_avg.*1000-home_pos(3);

x_ref = -(wp_DNN(:,2)-home_pos(2));
y_ref = wp_DNN(:,1)-home_pos(1);
z_ref = wp_DNN(:,3)-home_pos(3);


% DNN plot for the first tile
plot(x,y,'-','MarkerSize',ms,'LineWidth',lw,'DisplayName','DNN');
plot(x_ref,y_ref,'-.','Color','k','LineWidth',lw,'DisplayName','actual');
scatter(x(1),y(1),80,'o','filled','CData',map(3,:))
scatter(x(end),y(end),100,'filled','CData',map(1,:),'Marker','square')


% Adjusting the first plot's appearance
ax = gca;
ax.FontSize = 14;
ax.LineWidth = 1.5;

xticks(-100:50:100)
% xticklabels(["-100","","","","100"])
% yticklabels(["-100","","","","100"])
xtickangle(gca, 0)
ytickangle(gca, 0)


if export_fig
    exportgraphics(gcf,'../figures/trajectory/circle-x-y.emf','ContentType', 'vector');
end

% Tile 2: X-Z
figure(2); clf;
hold on; grid on; axis equal; box on;
set(gcf, 'Color', 'white');
set(gcf,'Units', 'inches','Position',[1,1,3.25,3]); % Adjusted for 2x1 layout


% Replotting for the second tile with X-Z view
% Note: Y-axis values are not needed for X-Z plot, so we use Z values as Y-axis here
plot(x,z,'-','MarkerSize',ms,'LineWidth',lw,'DisplayName','DNN');
plot(x_ref,z_ref,'-.','Color','k','LineWidth',lw,'DisplayName','actual');
scatter(x(1),z(1),80,'o','filled','CData',map(3,:))
scatter(x(end),z(end),100,'filled','CData',map(1,:),'Marker','square')


% Adjusting the second plot's appearance
ax = gca;
ax.FontSize = 14;
ax.LineWidth = 1.5;

xlim([-100,100])
ylim([-50,150])
xticks(-100:50:100)
yticks(-50:50:150)
% xticklabels(["-100","","","","100"])
% yticklabels(["-50","","","","150"])
xtickangle(gca, 0)
ytickangle(gca, 0)

mean(circle_position_error)
mean(circle_orientation_error)

if export_fig
    exportgraphics(gcf,'../figures/trajectory/circle-y-z.emf','ContentType', 'vector');
end

figure(3); clf;
hold on; grid on; box on;
set(gcf, 'Color', 'white');
set(gcf,'Units', 'inches','Position',[1,1,3.5,3]); % Adjusted for 2x1 layout

% View 1: XY

x = -(T_DNN.y_end_avg.*1000-home_pos(2));
y = T_DNN.x_end_avg.*1000-home_pos(1);
z = T_DNN.z_end_avg.*1000-home_pos(3);

x_ref = -(wp_DNN(:,2)-home_pos(2));
y_ref = wp_DNN(:,1)-home_pos(1);
z_ref = wp_DNN(:,3)-home_pos(3);


% DNN plot for the first tile
plot(circle_seconds,x,'LineWidth',lw,'Color',map(4,:))
plot(circle_seconds,x_ref,'-.','LineWidth',lw,'Color',map(4,:))
plot(circle_seconds,y,'LineWidth',lw,'Color',map(5,:))
plot(circle_seconds,y_ref,'-.','LineWidth',lw,'Color',map(5,:))
plot(circle_seconds,z,'LineWidth',lw,'Color',map(3,:))
plot(circle_seconds,z_ref,'-.','LineWidth',lw,'Color',map(3,:))

xlim([0,400])
ylim([-125,125])
xticks(0:100:400)
yticks(-100:50:100)
% xticklabels(["0","","","","400"])
% yticklabels(["-100","","","","100"])
xtickangle(gca, 0)
ytickangle(gca, 0)

% Adjusting the first plot's appearance
ax = gca;
ax.FontSize = 14;
ax.LineWidth = gw;

if export_fig
    exportgraphics(gcf,'../figures/trajectory/circle-pos.emf','ContentType', 'vector');
end

%% Plotting out trajectory runs (triangle)

% DNN
exp_DNN = 'triangle_2024_02_22_15_48_39';
motor_inputs = load(['./training/experiments/',exp_DNN,'/DNN_triangle_trajectory_inputs.mat']).output;
wp_DNN = load(['./training/experiments/',exp_DNN,'/triangle_trajectory.mat']).wp;
T_DNN = readtable(['./training/experiments/',exp_DNN,'/positions.csv']);

triangle_seconds = find_seconds(T_DNN.dateAndTime);

ref_quat = [wp_DNN(:,7),wp_DNN(:,4),wp_DNN(:,5),wp_DNN(:,6)];
measured_quat = [T_DNN.qw_end_avg,T_DNN.qx_end_avg,T_DNN.qy_end_avg,T_DNN.qz_end_avg];
measured_quat = remove_twist(measured_quat);
triangle_orientation_error = rad2deg(dist(quaternion(ref_quat),quaternion(measured_quat)));
triangle_position_error = sqrt(sum((wp_DNN(:,1:3)-(1000.*[T_DNN.x_end_avg,T_DNN.y_end_avg,T_DNN.z_end_avg])).^2,2)); 


figure(4); clf;
hold on; grid on; axis equal; box on;
set(gcf, 'Color', 'white');
set(gcf,'Units', 'inches','Position',[1,1,3.5,3]); % Adjusted for 2x1 layout

% View 1: XY
xlim([-75,125])

ylim([-100,100])


x_ref = -(wp_DNN(:,2)-home_pos(2));
y_ref = wp_DNN(:,1)-home_pos(1);
z_ref = wp_DNN(:,3)-home_pos(3);
x0 = x_ref(1);
y0 = y_ref(1);
x_ref = x_ref - x0;
y_ref = y_ref - y0;

x = -(T_DNN.y_end_avg.*1000-home_pos(2));
y = T_DNN.x_end_avg.*1000-home_pos(1);
z = T_DNN.z_end_avg.*1000-home_pos(3);
x = x-x0;
y = y-y0;


% DNN plot for the first tile
plot(x,y,'-','MarkerSize',ms,'LineWidth',lw,'DisplayName','DNN');
plot(x_ref,y_ref,'-.','Color','k','LineWidth',lw,'DisplayName','actual');
scatter(x(1),y(1),80,'o','filled','CData',map(3,:))
scatter(x(end),y(end),100,'filled','CData',map(1,:),'Marker','square')


xlim([-100,100])
ylim([-100,100])
xticks(-100:50:100)
yticks(-100:50:100)
% xticklabels(["-100","","","","100"])
% yticklabels(["-100","","","","100"])
xtickangle(gca, 0)
ytickangle(gca, 0)

% Adjusting the first plot's appearance
ax = gca;
ax.FontSize = 14;
ax.LineWidth = 1.5;

if export_fig
    exportgraphics(gcf,'../figures/trajectory/triangle-x-y.emf','ContentType', 'vector');
end

% Tile 2: X-Z
figure(5); clf;
hold on; grid on; axis equal; box on;
set(gcf, 'Color', 'white');
set(gcf,'Units', 'inches','Position',[1,1,3.25,3]); % Adjusted for 2x1 layout

xlim([-75,125]);
ylim([0,100]);

% Replotting for the second tile with X-Z view
% Note: Y-axis values are not needed for X-Z plot, so we use Z values as Y-axis here
plot(x,z,'-','MarkerSize',ms,'LineWidth',lw,'DisplayName','DNN');
plot(x_ref,z_ref,'-.','Color','k','LineWidth',lw,'DisplayName','actual');
scatter(x(1),z(1),80,'o','filled','CData',map(3,:))
scatter(x(end),z(end),100,'filled','CData',map(1,:),'Marker','square')

mean(triangle_position_error)
mean(triangle_orientation_error)

% Adjusting the second plot's appearance
ax = gca;
ax.FontSize = 14;
ax.LineWidth = 1.5;

xlim([-100,100])
ylim([-50,150])
xticks(-100:50:100)
yticks(-50:50:150)
% xticklabels(["-100","","","","100"])
% yticklabels(["-50","","","","150"])
xtickangle(gca, 0)
ytickangle(gca, 0)

if export_fig
    exportgraphics(gcf,'../figures/trajectory/triangle-y-z.emf','ContentType', 'vector');
end

figure(6); clf;
hold on; grid on; box on;
set(gcf, 'Color', 'white');
set(gcf,'Units', 'inches','Position',[1,1,3.5,3]); % Adjusted for 2x1 layout

% View 1: XY

x = -(T_DNN.y_end_avg.*1000-home_pos(2));
y = T_DNN.x_end_avg.*1000-home_pos(1);
z = T_DNN.z_end_avg.*1000-home_pos(3);

x_ref = -(wp_DNN(:,2)-home_pos(2));
y_ref = wp_DNN(:,1)-home_pos(1);
z_ref = wp_DNN(:,3)-home_pos(3);


% DNN plot for the first tile
plot(circle_seconds,x,'LineWidth',lw,'Color',map(4,:))
plot(circle_seconds,x_ref,'-.','LineWidth',lw,'Color',map(4,:))
plot(circle_seconds,y,'LineWidth',lw,'Color',map(5,:))
plot(circle_seconds,y_ref,'-.','LineWidth',lw,'Color',map(5,:))
plot(circle_seconds,z,'LineWidth',lw,'Color',map(3,:))
plot(circle_seconds,z_ref,'-.','LineWidth',lw,'Color',map(3,:))


xlim([0,400])
ylim([-125,125])
xticks(0:100:400)
yticks(-100:50:100)
% xticklabels(["0","","","","400"])
% yticklabels(["-100","","","","100"])
xtickangle(gca, 0)
ytickangle(gca, 0)


% Adjusting the first plot's appearance
ax = gca;
ax.FontSize = 14;
ax.LineWidth = 1.5;

if export_fig
    exportgraphics(gcf,'../figures/trajectory/triangle-pos.emf','ContentType', 'vector');
end

%% Plotting out trajectory runs (line)

% DNN
exp_DNN = 'line_2024_02_22_17_32_07';
motor_inputs = load(['./training/experiments/',exp_DNN,'/DNN_line_trajectory_inputs.mat']).output;
wp_DNN = load(['./training/experiments/',exp_DNN,'/line_trajectory.mat']).wp;
T_DNN = readtable(['./training/experiments/',exp_DNN,'/positions.csv']);

steps_seconds = find_seconds(T_DNN.dateAndTime);

ref_quat = [wp_DNN(:,7),wp_DNN(:,4),wp_DNN(:,5),wp_DNN(:,6)];
measured_quat = [T_DNN.qw_end_avg,T_DNN.qx_end_avg,T_DNN.qy_end_avg,T_DNN.qz_end_avg];
measured_quat = remove_twist(measured_quat);
steps_position_error = sqrt(sum((wp_DNN(:,1:3)-(1000.*[T_DNN.x_end_avg,T_DNN.y_end_avg,T_DNN.z_end_avg])).^2,2)); 
steps_orientation_error = rad2deg(dist(quaternion(ref_quat),quaternion(measured_quat)));

figure(7); clf;
hold on; grid on; axis equal; box on;
set(gcf, 'Color', 'white');
set(gcf,'Units', 'inches','Position',[1,1,3.5,3]); % Adjusted for 2x1 layout


x = -(T_DNN.y_end_avg.*1000-home_pos(2));
y = T_DNN.x_end_avg.*1000-home_pos(1);
z = T_DNN.z_end_avg.*1000-home_pos(3);

x_ref = -(wp_DNN(:,2)-home_pos(2));
y_ref = wp_DNN(:,1)-home_pos(1);
z_ref = wp_DNN(:,3)-home_pos(3);


% DNN plot for the first tile
plot(x,y,'-','MarkerSize',ms,'LineWidth',lw,'DisplayName','DNN');
plot(x_ref,y_ref,'-.','Color','k','LineWidth',lw,'DisplayName','actual');
scatter(x(1),y(1),80,'o','filled','CData',map(3,:))
scatter(x(end),y(end),100,'filled','CData',map(1,:),'Marker','square')

xlim([-100,100])
ylim([-100,100])
xticks(-100:50:100)
yticks(-100:50:100)
% xticklabels(["-100","","","","100"])
% yticklabels(["-100","","","","100"])
xtickangle(gca, 0)
ytickangle(gca, 0)

% Adjusting the first plot's appearance
ax = gca;
ax.FontSize = 14;
ax.LineWidth = 1.5;

if export_fig
    exportgraphics(gcf,'../figures/trajectory/stairs-x-y.emf','ContentType', 'vector');
end


% Tile 2: X-Z
figure(8); clf;
hold on; grid on; axis equal; box on;
set(gcf, 'Color', 'white');
set(gcf,'Units', 'inches','Position',[1,1,3.25,3]);

xlim([-100,100])
ylim([0,100])

% Replotting for the second tile with X-Z view
% Note: Y-axis values are not needed for X-Z plot, so we use Z values as Y-axis here
plot(-(T_DNN.y_end_avg.*1000-home_pos(2)),T_DNN.z_end_avg.*1000-home_pos(3),'-','MarkerSize',ms,'LineWidth',lw,'DisplayName','DNN');
plot(-(wp_DNN(:,2)-home_pos(2)),wp_DNN(:,3)-home_pos(3),'-.','Color','k','LineWidth',lw,'DisplayName','actual');
scatter(x(1),z(1),80,'o','filled','CData',map(3,:))
scatter(x(end),z(end),100,'filled','CData',map(1,:),'Marker','square')

% legend('Location', 'bestoutside');

mean(steps_position_error)
mean(steps_orientation_error)

% Adjusting the second plot's appearance
ax = gca;
ax.FontSize = 14;
ax.LineWidth = 1.5;

xlim([-100,100])
ylim([-50,150])
xticks(-100:50:100)
yticks(-50:50:150)
% xticklabels(["-100","","","","100"])
% yticklabels(["-50","","","","150"])
xtickangle(gca, 0)
ytickangle(gca, 0)

if export_fig
    exportgraphics(gcf,'../figures/trajectory/stairs-y-z.emf','ContentType', 'vector');
end

figure(9); clf;
hold on; grid on; box on;
set(gcf, 'Color', 'white');
set(gcf,'Units', 'inches','Position',[1,1,3.5,3]); % Adjusted for 2x1 layout

% View 1: XY

x = -(T_DNN.y_end_avg.*1000-home_pos(2));
y = T_DNN.x_end_avg.*1000-home_pos(1);
z = T_DNN.z_end_avg.*1000-home_pos(3);

x_ref = -(wp_DNN(:,2)-home_pos(2));
y_ref = wp_DNN(:,1)-home_pos(1);
z_ref = wp_DNN(:,3)-home_pos(3);


% DNN plot for the first tile
plot(circle_seconds,x,'LineWidth',lw,'Color',map(4,:))
plot(circle_seconds,x_ref,'-.','LineWidth',lw,'Color',map(4,:))
plot(circle_seconds,y,'LineWidth',lw,'Color',map(5,:))
plot(circle_seconds,y_ref,'-.','LineWidth',lw,'Color',map(5,:))
plot(circle_seconds,z,'LineWidth',lw,'Color',map(3,:))
plot(circle_seconds,z_ref,'-.','LineWidth',lw,'Color',map(3,:))


xlim([0,400])
ylim([-125,125])
xticks(0:100:400)
yticks(-100:50:100)
% xticklabels(["0","","","","400"])
% yticklabels(["-100","","","","100"])
xtickangle(gca, 0)
ytickangle(gca, 0)


% Adjusting the first plot's appearance
ax = gca;
ax.FontSize = 14;
ax.LineWidth = 1.5;

if export_fig
    exportgraphics(gcf,'../figures/trajectory/steps-pos.emf','ContentType', 'vector');
end

%% Plot out orientation error

figure(10); clf;
hold on; grid on; box on;
set(gcf, 'Color', 'white');
set(gcf,'Units', 'inches','Position',[1,1,3.8,3.3]); % Adjusted for 2x1 layout


plot(circle_seconds,circle_orientation_error,'color','k','LineWidth',lw)

ax = gca;
ax.FontSize = 16;
ax.LineWidth = 1.5;
ylim([0,6])
xticks([0:100:400])


if export_fig
    exportgraphics(gcf,'../figures/trajectory/circle-angle-error.emf','ContentType', 'vector');
end

figure(11); clf;
hold on; grid on; box on;
set(gcf, 'Color', 'white');
set(gcf,'Units', 'inches','Position',[1,1,3.8,3.3]); % Adjusted for 2x1 layout


plot(triangle_seconds,triangle_orientation_error,'color','k','LineWidth',lw)

ax = gca;
ax.FontSize = 16;
ax.LineWidth = 1.5;
ylim([0,6])
xticks([0:100:400])

if export_fig
    exportgraphics(gcf,'../figures/trajectory/triangle-angle-error.emf','ContentType', 'vector');
end

figure(12); clf;
hold on; grid on; box on;
set(gcf, 'Color', 'white');
set(gcf,'Units', 'inches','Position',[1,1,3.8,3.3]); % Adjusted for 2x1 layout


plot(steps_seconds,steps_orientation_error,'color','k','LineWidth',lw)

ax = gca;
ax.FontSize = 16;
ax.LineWidth = 1.5;
ylim([0,6])
xticks([0:100:400]);

if export_fig
    exportgraphics(gcf,'../figures/trajectory/stairs-angle-error.emf','ContentType', 'vector');
end

%% Helper functions

function format_axes()
    % Assuming 'ax' is your axes handle. If you don't have one explicitly, you can use gca to get the current axes.
    ax = gca;
    
    % Get the current ticks
    xticks = get(ax, 'XTick');
    yticks = get(ax, 'YTick');
    
    % Set only the first and last tick marks for the x-axis
    set(ax, 'XTick', xticks);
    
    % Initialize a cell array of empty strings for each tick mark
    xticklabels = repmat({''}, size(xticks));
    
    % Set the labels for the first and last tick mark
    xticklabels{1} = num2str(xticks(1));
    xticklabels{end} = num2str(xticks(end));
    
    % Apply the labels to the x-axis
    set(ax, 'XTickLabel', xticklabels);
    
    % Do the same for the y-axis
    set(ax, 'YTick', yticks);
    yticklabels = repmat({''}, size(yticks));
    yticklabels{1} = num2str(yticks(1));
    yticklabels{end} = num2str(yticks(end));
    set(ax, 'YTickLabel', yticklabels);
end


function secondsArray = find_seconds(dateStrings)

% Convert string to datetime
dateTimes = datetime(dateStrings, 'InputFormat', 'dd-MMM-yyyy HH:mm:ss');

% Initialize an array to store seconds
secondsArray = zeros(size(dateTimes, 1), 1);

% Loop through each datetime and calculate seconds
for i = 1:length(dateTimes)
    % Extract hours, minutes, and seconds
    [hours, minutes, seconds] = hms(dateTimes(i));
    
    % Calculate total seconds
    totalSeconds = hours * 3600 + minutes * 60 + seconds;
    
    % Store in the array
    secondsArray(i) = totalSeconds;
end

secondsArray = secondsArray - secondsArray(1);

end


function [Q_new] = remove_twist(Q)

Q_new = zeros(size(Q));
q_1 = Q(1,:);

eul = quat2eul(q_1, 'XYZ');
theta = -eul(3);
Rz = [cos(theta) -sin(theta) 0;
      sin(theta) cos(theta)  0;
      0          0           1];

for i = 1:size(Q)
    q_i = Q(i,:);
    R_i = quat2rotm(q_i);
    R_new = R_i*Rz;
    q_new = rotm2quat(R_new);
    Q_new(i,:) = q_new;
end

end

