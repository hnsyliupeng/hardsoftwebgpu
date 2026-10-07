// generated from ts/trunc/types.ts by tools/ts-emit.mjs — do not edit
/**
 * types.ts — shared shapes of the ported TRUNC model.
 *
 * Ported from the original MATLAB (TransformativeRoboticsLab/TRUNC):
 *   matlab/training/kinematics.m            constant-curvature segment model
 *   matlab/training/util/robotArm.m         the arm class and its servo loop
 *   matlab/training/util/armMotor.m         relay-pulsed tool motor
 *   matlab/training/generate_trajectory.m   the five task trajectories (mm)
 *   matlab/setup.m                          home / compression cable vectors
 *   matlab/norm_quat.m                      quaternion normalisation
 *   matlab/cross_coupling_analysis.m        trial splitting + error bounds
 *   matlab/efficiency_analysis.m            mechanical efficiency
 *   matlab/plot_cvjoint.m                   CV-joint bend / extension trials
 *
 * Everything is millimetres and degrees at the boundary, because that is what
 * the MATLAB speaks; the conversions happen in `math.ts` only where the maths
 * needs radians.
 */

/** 3-vector in millimetres (world frame, +Z up, matching the MATLAB plots). */
                                            

/** Quaternion in MATLAB order: w first, then x, y, z. */
                                                    

/** Column-major 4x4 matrix packed as 16 numbers (MATLAB `T(:)` order). */
                                

/** One row of a generated trajectory: position (mm), quaternion, pause, motor. */
                           
                                     
          
                                      
          
                                                                     
                
                                                          
                
 

/** The nine servo channels, in the order the MATLAB packs them. */
                                   

/** A joint-space configuration of the three segments. */
                             
                                    
             
             
              
             
             
              
             
             
                                                                     
            
                                        
                     
 

/** Result of one pose evaluation. */
                          
                                                    
                              
                                                                           
                               
                                                                               
                   
                           
                 
 

/** Serialised geometry sample for the animation. */
                             
                                                                      
                       
                                                
                
                                 
             
                             
             
 


//# sourceURL=/home/user/hardsoftwebgpu/ts/trunc/types.ts