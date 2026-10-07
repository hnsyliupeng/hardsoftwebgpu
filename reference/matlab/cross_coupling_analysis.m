%% Global setup

close all; clear all; clc
warning('off','all')

% fig sizes and scale factor
fig_w = 300; fig_h = 300; fig_s = 3;

% fonts
ax_font_size = 5*fig_s;
legend_font_size = 5*fig_s;
set(0,'DefaultTextFontname', 'CMU Sans Serif' )
set(0,'DefaultAxesFontName', 'CMU Sans Serif' )

% colors
map = brewermap(9,'Set1');

% save path
export_fig = true;


%% Load-in all data

T_11 = readtable("./instron/cross-coupling/trial_1_1.csv");
T_21 = readtable("./instron/cross-coupling/trial_2_1.csv");


%% Plot data

fig = figure(1); clf; hold on;  box on;
grid on

[r_11,t_11] = process_data(T_11);
t_11(:,:) = t_11(:,:) - t_11(1,:);
t_11 = t_11*1000;
r_11_mean = mean(r_11,2);
t_11_mean = mean(t_11,2);
t_11_max = reshape(max(t_11,[],2)-t_11_mean,[],1);
t_11_min = reshape(t_11_mean-min(t_11,[],2),[],1);

% Correct construction of the error bounds matrix
shadedErrorBar(deg2rad(r_11_mean), t_11_mean, [t_11_max,t_11_min], 'lineProps', {'Color', map(2,:), 'LineWidth', 3, 'MarkerSize', 10, 'DisplayName', ''}, 'transparent', false);

xlim([0,deg2rad(10)])
ylim([0,3])


% shadedErrorBar(mean(r,2),mean(t,2),[reshape(t_max,[],1),reshape(t_min,[],1)],'lineProps',{'Color',map(2,:),'lineWidth',3,'MarkerSize',10,"DisplayName",""})
yline(5*(0.05/100)*1000,'k--','LineWidth',2)

% figure formatting
set(gcf,'color','w');
set(fig, 'Units', 'inches');
width = 1.35;
height = 1.15;
set(fig, 'Position', [0, 0, width*fig_s, height*fig_s]);

% axis formatting
set(findobj(gcf,'type','axes'),'FontSize',ax_font_size,'LineWidth',1.5);

% export fig
if export_fig
    exportgraphics(gcf,'../figures/coupling/plot_11.png','Resolution',300*fig_s)
end


%% Plot data

fig = figure(2); clf; hold on;  box on;
grid on

[r_21,t_21] = process_data(T_21);
t_21(:,:) = t_21(:,:) - t_21(1,:);
t_21 = t_21*1000;
r_21_mean = mean(r_21,2);
t_21_mean = mean(t_21,2);
t_21_max = reshape(max(t_21,[],2)-t_21_mean,[],1);
t_21_min = reshape(t_21_mean-min(t_21,[],2),[],1);

% Correct construction of the error bounds matrix
shadedErrorBar(deg2rad(r_21_mean), t_21_mean, [t_21_max,t_21_min], 'lineProps', {'Color', map(1,:), 'LineWidth', 3, 'MarkerSize', 10, 'DisplayName', ''}, 'transparent', false);

xlim([0,deg2rad(10)])
ylim([0,3])

[r_21,t_21] = process_data(T_21);

yline(5*(0.05/100)*1000,'k--','LineWidth',2)

% figure formatting
set(gcf,'color','w');
set(fig, 'Units', 'inches');
width = 1.35;
height = 1.15;
set(fig, 'Position', [0, 0, width*fig_s, height*fig_s]);

% axis formatting
set(findobj(gcf,'type','axes'),'FontSize',ax_font_size,'LineWidth',1.5);

% export fig
if export_fig
    exportgraphics(gcf,'../figures/coupling/plot_21.png','Resolution',300*fig_s)
end

%% Helper Function 

function [rotations,torques] = process_data(T)

    % Load data from CSV
    data = T;
    
    % Calculate the absolute difference in 'Rotation'
    rotation_diff = abs([0; diff(data.Rotation)]);
    
    % Identify trial start indexes
    threshold = 5;
    trial_starts = find(rotation_diff > threshold);
    
    % Ensure including the start of the data as the first trial start
    trial_starts = [1; trial_starts];
    
    % Split data into individual trials
    trials = {};
    for i = 1:length(trial_starts)
        if i < length(trial_starts)
            trials{end+1} = data(trial_starts(i):trial_starts(i+1)-1, :);
        else
            trials{end+1} = data(trial_starts(i):end, :);
        end
    end
    
    % Find the minimum length of trials
    min_length = min(cellfun(@(c) height(c), trials));
    
    % Trim trials to the minimum length and store Rotation and Torque
    rotations = [];
    torques = [];
    for i = 1:length(trials)
        trial = trials{i};
        rotations(:,i) = trial.Rotation(1:min_length);
        torques(:,i) = trial.Torque(1:min_length);
    end

end


