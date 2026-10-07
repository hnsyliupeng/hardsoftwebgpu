close all; clear; clc;

% Read the data from CSV file
T = readtable("./training/data/2024_02_19_21_08_57/positions_norm_full.csv");

% Extract X, Y, and Z data points
X = (T.x_end_avg - mean(T.x_end_avg)).*1000; 
Y = (T.y_end_avg - mean(T.y_end_avg)).*1000;
Z = (T.z_end_avg - min(T.z_end_avg)).*1000;

map = brewermap(9,'Set1');

%% First plot

% Assuming you have a point cloud 'pts' (Nx3 matrix), and you've created an alpha shape 'shp'
pts = [X,Y,Z];

shp = alphaShape(pts(:,1), pts(:,2), pts(:,3));

shp.Alpha

% Step 1: Extract boundary facets and points from the original alpha shape
[bf, P] = boundaryFacets(shp);

% Initialize an array to store intersection points
intersectionPoints = [];

% Step 2: Iterate over each face to find intersections with the y=0 plane
for i = 1:size(bf,1)
    facePoints = P(bf(i,:), :);
    
    minY = min(facePoints(:,2));
    maxY = max(facePoints(:,2));
    if minY <= 0 && maxY >= 0
        for j = 1:3
            p1 = facePoints(j, :);
            p2 = facePoints(mod(j,3)+1, :);
            
            if (p1(2) <= 0 && p2(2) >= 0) || (p1(2) >= 0 && p2(2) <= 0)
                t = abs(p1(2)) / (abs(p1(2)) + abs(p2(2)));
                intersectionPoint = p1 + t * (p2 - p1);
                intersectionPoints(end+1, :) = intersectionPoint; % Store full intersection point
            end
        end
    end
end


% Plotting
figure(1); clf; hold on; grid on; box on; axis equal;

% Assuming intersectionPoints is your Nx2 matrix of intersection points

intersectionPoints = unique(intersectionPoints,'rows');

p1 = [-273.032,0,215.332];
p2 = [-255.981,0,197.122];

rest = find(sum((intersectionPoints-p1).^2,2) > 0.0001 & sum((intersectionPoints-p2).^2,2) > 0.0001);
intersectionPoints = [p1;p2;intersectionPoints(rest,:)];

orderedPoints = orderPointsUsingNN(intersectionPoints);

% Now, you can plot your ordered points as a patch or using a line plot
% plot(shp,'EdgeColor','none', 'EdgeAlpha',0.25, 'FaceColor','#BEBEBE','LineWidth',.5); % Plot the original alpha shape
% plot3(orderedPoints(:,1),  orderedPoints(:,2), orderedPoints(:,3), 'Color','g', 'LineWidth', 2);
scatter3(X(Y>0),Y(Y>0),Z(Y>0),[],"filled",'MarkerFaceColor','#BEBEBE','MarkerEdgeColor','k','lineWidth',.5)
fill3(orderedPoints(:,1),  orderedPoints(:,2)-1, orderedPoints(:,3), 'k', 'FaceAlpha',1,'EdgeColor','none');

xlim([-350,350])
ylim([-1,350])
zlim([0,275])

xticks([-300,-150,0,150,300])
xticklabels({'-300', '-150', '0', '150', '-300'})
yticks([-300,-150,0,150,300])
yticklabels({'-300', '-150', '0', '150', '-300'})

view(0,0)
% Set the size of the axes lines and text
ax = gca; % Current axes
ax.FontSize = 14; % Change to desired font size
ax.LineWidth = 1.05; % Change to desired axis line width
set(gcf, 'Color', 'white');
set(gcf,'Units', 'inches','Position',[1,1,3.5,3.5])

% Adding lighting to the scene
% camlight left; % Add a camera light from the left
% lighting gouraud; % Use Gouraud lighting
% material dull; % Apply a material that diffuses the light

exportgraphics(gcf,'../figures/workspace/x-z.emf','ContentType', 'vector');

%% Second plot


% Plotting
figure(2); clf; hold on; grid on; box on;

% Now, you can plot your ordered points as a patch or using a line plot
% plot(shp,'EdgeColor','none', 'EdgeAlpha',0.25, 'FaceColor','#BEBEBE','LineWidth',.5); % Plot the original alpha shape
scatter3(X,Y,Z,[],"filled",'MarkerFaceColor','#BEBEBE','MarkerEdgeColor','k','lineWidth',.5)

xlim([-350,350])
ylim([-350,350])
zlim([0,275])

xticks([-300,-150,0,150,300])
xticklabels({'-300', '-150', '0', '150', '-300'})
yticks([-300,-150,0,150,300])
yticklabels({'-300', '-150', '0', '150', '-300'})

view(0,90)
% Set the size of the axes lines and text
ax = gca; % Current axes
ax.FontSize = 14; % Change to desired font size
ax.LineWidth = 1.5; % Change to desired axis line width
set(gcf, 'Color', 'white');
set(gcf,'Units', 'inches','Position',[1,1,3.5,3.5])

% Adding lighting to the scene
camlight left
lighting gouraud; % Use Gouraud lighting
material dull; % Apply a material that diffuses the light

exportgraphics(gcf,'../figures/workspace/x-y.emf','ContentType', 'vector');

%%

function rgb = hex2rgb(hexStr)
    % Convert a hex color string to an RGB vector
    if hexStr(1) == '#'
        hexStr = hexStr(2:end);
    end
    if numel(hexStr) ~= 6
        error('Hex color code must be 6 characters long.');
    end
    rgb = [hex2dec(hexStr(1:2)), hex2dec(hexStr(3:4)), hex2dec(hexStr(5:6))]/255;
end

function orderedPoints = orderPointsUsingNN(intersectionPoints)
    % Number of points to order
    numPoints = size(intersectionPoints, 1);
    
    % Initialize the array for ordered points
    orderedPoints = zeros(numPoints, 3); % Keep 3D structure for clarity
    
    % Start with the first point
    orderedPoints(1:2,:) = intersectionPoints(1:2,:);
    
    % Mark points as unused initially
    used = false(numPoints, 1);
    used(1) = true; % Mark the first point as used
    
    % Loop to order points based on nearest neighbor
    for i = 3:numPoints
        lastPoint = orderedPoints(i-1, :);
        
        % Calculate distances from the last point to all others
        distances = sqrt(sum((intersectionPoints - lastPoint).^2, 2));
        distances(used) = inf; % Set distances for used points to infinity
        
        % Find the nearest unused point
        [~, idx] = min(distances);
        
        % Add the nearest unused point to the ordered list
        orderedPoints(i,:) = intersectionPoints(idx, :);
        
        % Mark this point as used
        used(idx) = true;
    end
end

% Ensure your intersectionPoints array is correct before passing it to this function.
% After obtaining the ordered points, proceed with the plotting as before.

